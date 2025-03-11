class WindowManager 
{
	#windows;
	#count;
	#id;
	#winData;
	#winShapeChangeCallback;
	#winChangeCallback;
	#particleSystemData; // New property to store particle system data
	
	constructor ()
	{
		let that = this;
		this.#particleSystemData = {};

		// event listener for when localStorage is changed from another window
		addEventListener("storage", (event) => 
		{
			if (event.key == "windows")
			{
				let newWindows = JSON.parse(event.newValue);
				let winChange = that.#didWindowsChange(that.#windows, newWindows);

				that.#windows = newWindows;

				if (winChange)
				{
					if (that.#winChangeCallback) that.#winChangeCallback();
				}
			}
			
			// Listen for particle system data updates
			if (event.key == "particleSystems") {
				try {
					that.#particleSystemData = JSON.parse(event.newValue) || {};
					// Trigger callback for particle data update if needed
					if (that.#winChangeCallback) that.#winChangeCallback();
				} catch (e) {
					console.error("Error parsing particle system data:", e);
				}
			}
		});

		// event listener for when current window is about to ble closed
		window.addEventListener('beforeunload', function (e) 
		{
			let index = that.getWindowIndexFromId(that.#id);

			//remove this window from the list and update local storage
			that.#windows.splice(index, 1);
			
			// Remove this window's particle data
			if (that.#particleSystemData[that.#id]) {
				delete that.#particleSystemData[that.#id];
				that.updateParticleSystemsLocalStorage();
			}
			
			that.updateWindowsLocalStorage();
		});
	}

	// check if theres any changes to the window list
	#didWindowsChange (pWins, nWins)
	{
		if (pWins.length != nWins.length)
		{
			return true;
		}
		else
		{
			let c = false;

			for (let i = 0; i < pWins.length; i++)
			{
				if (pWins[i].id != nWins[i].id) c = true;
			}

			return c;
		}
	}

	// initiate current window (add metadata for custom data to store with each window instance)
	init (metaData)
	{
		this.#windows = JSON.parse(localStorage.getItem("windows")) || [];
		this.#count= localStorage.getItem("count") || 0;
		this.#count++;
		
		this.#particleSystemData = JSON.parse(localStorage.getItem("particleSystems")) || {};

		this.#id = this.#count;
		let shape = this.getWinShape();
		this.#winData = {id: this.#id, shape: shape, metaData: metaData};
		this.#windows.push(this.#winData);

		localStorage.setItem("count", this.#count);
		this.updateWindowsLocalStorage();
	}

	// Update particle system data for this window
	updateParticleSystem(blackHolePosition, particleCount) {
		if (!this.#particleSystemData) {
			this.#particleSystemData = {};
		}
		
		this.#particleSystemData[this.#id] = {
			blackHolePosition: blackHolePosition,
			particleCount: particleCount,
			lastUpdate: Date.now()
		};
		
		this.updateParticleSystemsLocalStorage();
	}
	
	// Save particle system data to localStorage
	updateParticleSystemsLocalStorage() {
		localStorage.setItem("particleSystems", JSON.stringify(this.#particleSystemData));
	}

	getWinShape ()
	{
		let shape = {x: window.screenLeft, y: window.screenTop, w: window.innerWidth, h: window.innerHeight};
		return shape;
	}

	getWindowIndexFromId (id)
	{
		let index = -1;

		for (let i = 0; i < this.#windows.length; i++)
		{
			if (this.#windows[i].id == id) index = i;
		}

		return index;
	}

	updateWindowsLocalStorage ()
	{
		localStorage.setItem("windows", JSON.stringify(this.#windows));
	}

	update ()
	{
		//console.log(step);
		let winShape = this.getWinShape();

		//console.log(winShape.x, winShape.y);

		if (winShape.x != this.#winData.shape.x ||
			winShape.y != this.#winData.shape.y ||
			winShape.w != this.#winData.shape.w ||
			winShape.h != this.#winData.shape.h)
		{
			
			this.#winData.shape = winShape;

			let index = this.getWindowIndexFromId(this.#id);
			this.#windows[index].shape = winShape;

			//console.log(windows);
			if (this.#winShapeChangeCallback) this.#winShapeChangeCallback();
			this.updateWindowsLocalStorage();
			
			// Update particle system position when window moves
			if (this.#particleSystemData[this.#id]) {
				this.#particleSystemData[this.#id].blackHolePosition = {
					x: winShape.x + winShape.w / 2,
					y: winShape.y + winShape.h / 2,
					z: 0
				};
				this.updateParticleSystemsLocalStorage();
			}
		}
	}

	setWinShapeChangeCallback (callback)
	{
		this.#winShapeChangeCallback = callback;
	}

	setWinChangeCallback (callback)
	{
		this.#winChangeCallback = callback;
	}

	getWindows ()
	{
		return this.#windows;
	}

	getParticleSystems() {
		return this.#particleSystemData || {};
	}
	
	getExternalParticleSystems() {
		const result = {};
		const currentId = this.#id;
		
		for (const [id, data] of Object.entries(this.#particleSystemData)) {
			if (id != currentId) {
				result[id] = data;
			}
		}
		
		return result;
	}

	getThisWindowData ()
	{
		return this.#winData;
	}

	getThisWindowID ()
	{
		return this.#id;
	}
	
	getWindowCount() {
		return this.#windows.length;
	}
}

export default WindowManager;