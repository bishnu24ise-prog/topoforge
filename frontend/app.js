/**
 * TopoForge - 3D Terrain Viewer
 * Main application logic
 */

// ===========================================
// STATE
// ===========================================
const state = {
    scene: null,
    camera: null,
    renderer: null,
    terrain: null,
    sun: null,

    // Data
    fileId: null,
    bounds: null,
    textureB64: null,
    heightmapB64: null,

    // Textures
    colorTexture: null,
    heightmapTexture: null,

    // Camera
    cameraMode: 'orbit',
    orbitAngle: 0,
    orbitRadius: 120,
    orbitPhi: Math.PI / 4,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    keys: {},

    // Plane mode
    plane: null,
    planeModel: null,
    planeMode: false,
    planeAudio: null
};

// ===========================================
// INITIALIZATION
// ===========================================
function init() {
    const container = document.getElementById('container');

    // Scene
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0a1628);

    // Camera
    state.camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        2000
    );
    updateOrbitCamera();

    // Renderer
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Enable shadow mapping
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(state.renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    state.scene.add(ambient);

    state.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    // Match original position: (-100, 150, 100)
    state.sun.position.set(-100, 150, 100);

    // Explicitly set target to terrain center
    state.sun.target.position.set(0, 0, 0);
    state.scene.add(state.sun.target);

    // Configure shadow casting
    state.sun.castShadow = true;
    state.sun.shadow.mapSize.width = 2048;
    state.sun.shadow.mapSize.height = 2048;

    // Shadow camera frustum (orthographic bounds)
    state.sun.shadow.camera.left = -75;
    state.sun.shadow.camera.right = 75;
    state.sun.shadow.camera.top = 75;
    state.sun.shadow.camera.bottom = -75;
    state.sun.shadow.camera.near = 1;
    state.sun.shadow.camera.far = 400;
    state.sun.shadow.camera.updateProjectionMatrix();

    // Shadow quality tuning - try zero bias first
    state.sun.shadow.bias = 0;

    state.scene.add(state.sun);

    // Water plane
    const waterGeo = new THREE.PlaneGeometry(400, 400);
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x1a4a6e,
        transparent: true,
        opacity: 0.9,
        roughness: 0.2
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1;
    water.receiveShadow = true;
    state.scene.add(water);

    // Initialize plane audio
    state.planeAudio = new Audio('./assets/plane.mp3');
    state.planeAudio.loop = true;
    state.planeAudio.volume = 0.5;

    // Load plane model with wrapper for correct orientation
    const gltfLoader = new THREE.GLTFLoader();
    gltfLoader.load('./assets/plane.glb', (gltf) => {
        // Create wrapper Object3D for movement (its -Z is forward)
        state.plane = new THREE.Object3D();

        // Add model as child with rotation offset to align visual forward
        state.planeModel = gltf.scene;
        state.planeModel.scale.set(0.25, 0.25, 0.25);
        state.planeModel.rotation.y = Math.PI / 2;  // Rotate model to face wrapper's -Z
        state.plane.add(state.planeModel);

        state.plane.visible = false;
        state.plane.rotation.order = 'YXZ';  // Yaw-Pitch-Roll order for flight controls
        state.scene.add(state.plane);
    });

    // Setup UI
    setupUI();
    updateStepNumbers();

    // Start render loop
    animate();

    setStatus('Ready. Upload a map to begin.');
}

// ===========================================
// UI SETUP
// ===========================================
function setupUI() {
    // File upload
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) uploadFile(file);
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadFile(file);
    });

    // Bounds inputs
    ['north', 'south', 'east', 'west'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if (!state.bounds) state.bounds = {};
            state.bounds[id] = parseFloat(e.target.value);
        });
    });

    // Extract bounds button
    document.getElementById('extract-bounds-btn').addEventListener('click', extractBoundsWithGemini);

    // Terrain buttons
    document.getElementById('fetch-dem-btn').addEventListener('click', fetchDEM);
    document.getElementById('stylize-btn').addEventListener('click', stylizeTexture);

    // View controls
    const exagSlider = document.getElementById('exag');
    exagSlider.addEventListener('input', () => {
        document.getElementById('exag-val').textContent = exagSlider.value + '×';
        if (state.terrain && state.heightmapTexture) {
            createTerrain(); // Rebuild terrain with new exaggeration
        }
    });

    const rotSlider = document.getElementById('rotation');
    rotSlider.addEventListener('input', () => {
        document.getElementById('rotation-val').textContent = rotSlider.value + '%';
    });

    const volumeSlider = document.getElementById('plane-volume');
    volumeSlider.addEventListener('input', () => {
        document.getElementById('plane-volume-val').textContent = volumeSlider.value + '%';
        if (state.planeAudio) {
            state.planeAudio.volume = volumeSlider.value / 100;
        }
    });

    // Lighting controls
    const azimuthSlider = document.getElementById('sun-azimuth');
    const elevationSlider = document.getElementById('sun-elevation');

    function updateSunPosition() {
        const azimuthDeg = parseFloat(azimuthSlider.value);
        const elevationDeg = parseFloat(elevationSlider.value);

        // Update value displays
        document.getElementById('sun-azimuth-val').textContent = azimuthDeg + '°';
        document.getElementById('sun-elevation-val').textContent = elevationDeg + '°';

        // Convert to radians
        const azimuthRad = azimuthDeg * Math.PI / 180;
        const elevationRad = elevationDeg * Math.PI / 180;

        // Calculate x,y,z position (distance matches original sun position)
        const distance = 206;
        const x = distance * Math.cos(elevationRad) * Math.cos(azimuthRad);
        const y = distance * Math.sin(elevationRad);
        const z = distance * Math.cos(elevationRad) * Math.sin(azimuthRad);

        // Update sun position
        if (state.sun) {
            state.sun.position.set(x, y, z);
        }
    }

    azimuthSlider.addEventListener('input', updateSunPosition);
    elevationSlider.addEventListener('input', updateSunPosition);

    document.getElementById('reset-sun-btn').addEventListener('click', () => {
        azimuthSlider.value = 135;
        elevationSlider.value = 47;
        updateSunPosition();
    });

    document.getElementById('fly-btn').addEventListener('click', toggleFlyMode);
    document.getElementById('voice-btn').addEventListener('click', toggleVoiceChat);

    // Map picker buttons
    document.getElementById('open-map-btn').addEventListener('click', openMapPicker);
    document.getElementById('close-map-btn').addEventListener('click', closeMapPicker);
    document.getElementById('confirm-map-btn').addEventListener('click', confirmMapPick);

    // Map style selector dropdown - dynamic live texture switching!
    document.getElementById('map-style-select').addEventListener('change', async () => {
        if (state.bounds) {
            showLoading('Updating map texture...');
            setStatus('Loading new map style...', 'loading');
            try {
                const satCanvas = await fetchSatelliteTiles(state.bounds);
                state.satCanvas = satCanvas;
                
                const loader = new THREE.TextureLoader();
                state.colorTexture = loader.load(satCanvas.toDataURL(), () => {
                    state.colorTexture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
                    state.colorTexture.needsUpdate = true;

                    if (state.terrain) {
                        state.terrain.material.map = state.colorTexture;
                        state.terrain.material.needsUpdate = true;
                    }
                    hideLoading();
                    setStatus('Map texture updated to ' + document.getElementById('map-style-select').value, 'success');
                });
            } catch (err) {
                hideLoading();
                setStatus('Failed to update map style: ' + err.message, 'error');
                console.error(err);
            }
        }
    });

    // Map size slider — redraw rectangle live
    document.getElementById('map-size-slider').addEventListener('input', onMapSizeChange);

    // Mouse controls
    setupMouseControls();

    // Keyboard controls
    document.addEventListener('keydown', (e) => state.keys[e.code] = true);
    document.addEventListener('keyup', (e) => state.keys[e.code] = false);

    // Resize
    window.addEventListener('resize', () => {
        state.camera.aspect = window.innerWidth / window.innerHeight;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function updateStepNumbers() {
    const sections = document.querySelectorAll('#controls section');
    let stepNumber = 1;

    sections.forEach(section => {
        const heading = section.querySelector('h3[data-step-label]');
        if (!heading) return;

        if (!section.classList.contains('hidden')) {
            const label = heading.dataset.stepLabel;
            heading.textContent = `${stepNumber}. ${label.toUpperCase()}`;
            stepNumber++;
        }
    });
}

function setupMouseControls() {
    const canvas = state.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
        if (state.cameraMode === 'orbit') {
            state.isDragging = true;
            state.lastMouse = { x: e.clientX, y: e.clientY };
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (state.cameraMode === 'orbit' && state.isDragging) {
            const dx = e.clientX - state.lastMouse.x;
            const dy = e.clientY - state.lastMouse.y;
            state.orbitAngle += dx * 0.01;
            state.orbitPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, state.orbitPhi + dy * 0.01));
            state.lastMouse = { x: e.clientX, y: e.clientY };
            updateOrbitCamera();
        } else if (state.cameraMode === 'fly' && document.pointerLockElement === canvas) {
            state.camera.rotation.y -= e.movementX * 0.002;
            state.camera.rotation.x = Math.max(
                -Math.PI / 2,
                Math.min(Math.PI / 2, state.camera.rotation.x - e.movementY * 0.002)
            );
        }
    });

    canvas.addEventListener('mouseup', () => state.isDragging = false);
    canvas.addEventListener('mouseleave', () => state.isDragging = false);

    canvas.addEventListener('wheel', (e) => {
        if (state.cameraMode === 'orbit') {
            state.orbitRadius = Math.max(20, Math.min(300, state.orbitRadius + e.deltaY * 0.1));
            updateOrbitCamera();
        }
    });
}

// ===========================================
// FILE UPLOAD
// ===========================================
async function uploadFile(file) {
    showLoading('Uploading...');
    setStatus('Uploading...', 'loading');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Upload failed');
        }

        const data = await response.json();

        // Store data
        state.fileId = data.file_id;
        state.textureB64 = data.texture_b64;

        // Update UI
        document.getElementById('file-info').classList.remove('hidden');
        document.getElementById('file-name').textContent = file.name;

        if (data.has_bounds) {
            state.bounds = data.bounds;
            document.getElementById('file-bounds').textContent = 'Georeferenced';
            document.getElementById('bounds-section').classList.add('hidden');

            // Update bounds inputs
            document.getElementById('north').value = data.bounds.north.toFixed(4);
            document.getElementById('south').value = data.bounds.south.toFixed(4);
            document.getElementById('east').value = data.bounds.east.toFixed(4);
            document.getElementById('west').value = data.bounds.west.toFixed(4);
        } else {
            document.getElementById('file-bounds').textContent = 'No bounds';
            document.getElementById('bounds-section').classList.remove('hidden');
        }

        // Load texture
        loadTexture(data.texture_b64);

        // Show terrain section
        document.getElementById('terrain-section').classList.remove('hidden');
        updateStepNumbers();

        hideLoading();
        setStatus(`Loaded: ${data.width}×${data.height}px`, 'success');

    } catch (err) {
        hideLoading();
        setStatus('Error: ' + err.message, 'error');
        console.error(err);
    }
}

// ===========================================
// TEXTURE & TERRAIN
// ===========================================
function loadTexture(base64) {
    const loader = new THREE.TextureLoader();
    state.colorTexture = loader.load('data:image/jpeg;base64,' + base64, () => {
        // Set maximum anisotropic filtering for razor-sharp graphics at all angles
        state.colorTexture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
        state.colorTexture.needsUpdate = true;
        
        // Create initial flat terrain
        createTerrain();
        document.getElementById('view-section').classList.remove('hidden');
        document.getElementById('lighting-section').classList.remove('hidden');
        document.getElementById('voice-section').classList.remove('hidden');
        updateStepNumbers();
    });
}

function createTerrain() {
    // Remove existing terrain
    if (state.terrain) {
        state.scene.remove(state.terrain);
        state.terrain.geometry.dispose();
        state.terrain.material.dispose();
    }

    const size = 100;
    const segments = 512; // Quadrupled vertex density (512x512) for razor-sharp organic peaks!
    const exag = parseFloat(document.getElementById('exag').value);

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);

    // Apply heightmap to actual geometry vertices (not displacement map)
    if (state.heightmapTexture) {
        applyHeightmapToGeometry(geometry, state.heightmapTexture, exag);
    }

    const material = new THREE.MeshStandardMaterial({
        map: state.colorTexture,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    state.terrain = new THREE.Mesh(geometry, material);
    state.terrain.rotation.x = -Math.PI / 2;
    state.terrain.castShadow = true;
    state.terrain.receiveShadow = true;
    state.scene.add(state.terrain);
}

function applyHeightmapToGeometry(geometry, heightmapTexture, scale) {
    const img = heightmapTexture.image;
    if (!img) return;

    // Create canvas to read pixel data
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);

    const positions = geometry.attributes.position;
    const width = Math.sqrt(positions.count);

    for (let i = 0; i < positions.count; i++) {
        const x = i % width;
        const y = Math.floor(i / width);

        // Sample heightmap
        const u = x / (width - 1);
        const v = y / (width - 1);
        const px = Math.floor(u * (img.width - 1));
        const py = Math.floor(v * (img.height - 1));
        const idx = (py * img.width + px) * 4;

        // Get grayscale value (0-255)
        const height = imgData.data[idx] / 255;

        // Apply to Z coordinate (plane is in XY, Z is up before rotation)
        positions.setZ(i, height * scale);
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals(); // Recalculate normals for proper lighting
}

// ===========================================
// DEM FETCHING
// ===========================================
async function fetchDEM() {
    if (!state.bounds) {
        setStatus('Set bounds first', 'error');
        return;
    }

    const { north, south, east, west } = state.bounds;
    const latSpan = Math.abs(north - south);
    // Dynamically calculate optimal zoom to keep grid size around 3x3 to 5x5 tiles
    let zoom = Math.floor(Math.log2(1800 / latSpan));
    zoom = Math.max(3, Math.min(zoom, 13));

    showLoading('Fetching elevation tiles...');
    setStatus('Fetching DEM...', 'loading');

    try {
        // Convert bounds to tile coords
        const minTile = latLonToTile(north, west, zoom);
        const maxTile = latLonToTile(south, east, zoom);

        const xMin = Math.min(minTile.x, maxTile.x);
        const xMax = Math.max(minTile.x, maxTile.x);
        const yMin = Math.min(minTile.y, maxTile.y);
        const yMax = Math.max(minTile.y, maxTile.y);

        const tileSize = 256;
        const width = (xMax - xMin + 1) * tileSize;
        const height = (yMax - yMin + 1) * tileSize;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Fetch tiles
        const tilePromises = [];
        for (let y = yMin; y <= yMax; y++) {
            for (let x = xMin; x <= xMax; x++) {
                const directUrl = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${zoom}/${x}/${y}.png`;
                const proxyUrl = `/api/dem-tile?z=${zoom}&x=${x}&y=${y}`;
                tilePromises.push(
                    loadImage(directUrl)
                        .catch(() => loadImage(proxyUrl)) // Fallback to same-origin proxy if direct fails
                        .then(img => ({ img, x: (x - xMin) * tileSize, y: (y - yMin) * tileSize }))
                        .catch(() => null)
                );
            }
        }

        const tiles = await Promise.all(tilePromises);

        // Draw tiles
        let loaded = 0;
        for (const tile of tiles) {
            if (tile?.img) {
                ctx.drawImage(tile.img, tile.x, tile.y);
                loaded++;
            }
        }

        if (loaded === 0) {
            throw new Error('No tiles loaded - try Gemini heightmap instead');
        }

        // Convert to elevation
        const imageData = ctx.getImageData(0, 0, width, height);
        const elevation = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            elevation[i] = (r * 256 + g + b / 256) - 32768;
        }

        // Find range
        let eMin = Infinity, eMax = -Infinity;
        for (const e of elevation) {
            if (e > 0) {
                eMin = Math.min(eMin, e);
                eMax = Math.max(eMax, e);
            }
        }

        // Create heightmap
        const hmCanvas = document.createElement('canvas');
        hmCanvas.width = width;
        hmCanvas.height = height;
        const hmCtx = hmCanvas.getContext('2d');
        const hmData = hmCtx.createImageData(width, height);

        for (let i = 0; i < width * height; i++) {
            let val = 0;
            if (elevation[i] > 0 && eMax > eMin) {
                val = ((elevation[i] - eMin) / (eMax - eMin)) * 255;
            }
            hmData.data[i * 4] = val;
            hmData.data[i * 4 + 1] = val;
            hmData.data[i * 4 + 2] = val;
            hmData.data[i * 4 + 3] = 255;
        }
        hmCtx.putImageData(hmData, 0, 0);

        // Crop to bounds
        const tileBoundsNW = tileToLatLon(xMin, yMin, zoom);
        const tileBoundsSE = tileToLatLon(xMax + 1, yMax + 1, zoom);

        const cropX = ((west - tileBoundsNW.lon) / (tileBoundsSE.lon - tileBoundsNW.lon)) * width;
        const cropY = ((tileBoundsNW.lat - north) / (tileBoundsNW.lat - tileBoundsSE.lat)) * height;
        const cropW = ((east - west) / (tileBoundsSE.lon - tileBoundsNW.lon)) * width;
        const cropH = ((north - south) / (tileBoundsNW.lat - tileBoundsSE.lat)) * height;

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = 512;
        finalCanvas.height = 512;
        finalCanvas.getContext('2d').drawImage(
            hmCanvas, cropX, cropY, cropW, cropH, 0, 0, 512, 512
        );

        // Create texture
        state.heightmapTexture = new THREE.CanvasTexture(finalCanvas);
        createTerrain();

        hideLoading();
        setStatus(`DEM loaded: ${eMin.toFixed(0)}m - ${eMax.toFixed(0)}m`, 'success');

    } catch (err) {
        hideLoading();
        setStatus('DEM Error: ' + err.message, 'error');
        console.error(err);
    }
}

function latLonToTile(lat, lon, z) {
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return { x, y };
}

function tileToLatLon(x, y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return {
        lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
        lon: x / Math.pow(2, z) * 360 - 180
    };
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (!url.startsWith('/') && !url.startsWith(window.location.origin)) {
            img.crossOrigin = 'anonymous';
        }
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

// ===========================================
// GEMINI INTEGRATION
// ===========================================
async function extractBoundsWithGemini() {
    if (!state.fileId) {
        setStatus('Upload a file first', 'error');
        return;
    }

    showLoading('Extracting bounds with Gemini...');
    setStatus('Analyzing map...', 'loading');

    try {
        const response = await fetch(`/api/extract-bounds?file_id=${state.fileId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to extract bounds');
        }

        const data = await response.json();
        state.bounds = data.bounds;

        // Update UI
        document.getElementById('north').value = data.bounds.north.toFixed(4);
        document.getElementById('south').value = data.bounds.south.toFixed(4);
        document.getElementById('east').value = data.bounds.east.toFixed(4);
        document.getElementById('west').value = data.bounds.west.toFixed(4);

        hideLoading();
        setStatus('Bounds extracted', 'success');

    } catch (err) {
        hideLoading();
        setStatus('Gemini error: ' + err.message, 'error');
        console.error(err);
    }
}

async function stylizeTexture() {
    if (!state.fileId) {
        setStatus('Upload a file first', 'error');
        return;
    }

    const btn = document.getElementById('stylize-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🎨 Stylizing...';

    showLoading('Stylizing texture...');
    setStatus('Applying styling...', 'loading');

    try {
        // For map picks, upload the satellite canvas first so backend has the file to stylize
        if (state.fileId.startsWith('map-') && state.satCanvas) {
            setStatus('Caching map on server...', 'loading');
            const blob = await new Promise(resolve => state.satCanvas.toBlob(resolve, 'image/jpeg', 0.9));
            const formData = new FormData();
            formData.append('file', blob, `${state.fileId}.jpg`);
            
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            if (!uploadRes.ok) throw new Error('Failed to cache map on server');
            const uploadData = await uploadRes.json();
            state.fileId = uploadData.file_id; // Set new backend-recognized fileId
        }

        const response = await fetch(`/api/stylize?file_id=${state.fileId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Stylization failed');
        }

        const data = await response.json();

        // Load stylized texture — works with both data URIs and CDN URLs
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');

        state.colorTexture = loader.load(
            data.stylized_url,
            () => {
                // Max anisotropic filtering
                state.colorTexture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
                state.colorTexture.needsUpdate = true;
                
                createTerrain();
                hideLoading();
                btn.disabled = false;
                btn.textContent = originalText;
                setStatus('Texture stylized successfully', 'success');
            },
            undefined,
            (error) => {
                throw new Error('Failed to load stylized texture: ' + error.message);
            }
        );

    } catch (err) {
        hideLoading();
        btn.disabled = false;
        btn.textContent = originalText;
        setStatus('Stylization error: ' + err.message, 'error');
        console.error(err);
    }
}

// ===========================================
// MAP PICKER
// ===========================================
const mapState = {
    leaflet: null,       // Leaflet map instance
    rectangle: null,     // Current drawn rectangle layer
    clickMarker: null,   // Pulsing marker at click point
    pickedLatLng: null,  // { lat, lng } of last click
    pickedBounds: null   // { north, south, east, west }
};

function openMapPicker() {
    document.getElementById('map-modal').classList.remove('hidden');

    // Init Leaflet only once
    if (!mapState.leaflet) {
        // Dark CartoDB tiles — free, no API key
        mapState.leaflet = L.map('leaflet-map', {
            center: [20.5937, 78.9629], // Center directly on India
            zoom: 4,                     // Zoomed closer so it's super clear
            zoomControl: true
        });

        L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            {
                attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/">OSM</a>',
                subdomains: 'abcd',
                maxZoom: 18,
                crossOrigin: true
            }
        ).addTo(mapState.leaflet);

        mapState.leaflet.on('click', onMapClick);
    }

    // Fix Leaflet size after modal becomes visible
    setTimeout(() => mapState.leaflet.invalidateSize(), 50);
}

function closeMapPicker() {
    document.getElementById('map-modal').classList.add('hidden');
}

function getMapHalfDeg() {
    // Slider value 1-20 → 0.1° to 2.0° half-size
    const val = parseInt(document.getElementById('map-size-slider').value);
    return val * 0.1;
}

function onMapSizeChange() {
    const half = getMapHalfDeg();
    const full = (half * 2).toFixed(1);
    document.getElementById('map-size-display').textContent = `~${full}° × ${full}°`;

    // Update slider gradient
    const slider = document.getElementById('map-size-slider');
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, #4ecdc4 0%, #4ecdc4 ${pct}%, #333 ${pct}%)`;

    // Redraw rectangle if a point is already selected
    if (mapState.pickedLatLng) {
        drawBoundingBox(mapState.pickedLatLng);
    }
}

function drawBoundingBox(latlng) {
    const half = getMapHalfDeg();

    const north = Math.min(90,  latlng.lat + half);
    const south = Math.max(-90, latlng.lat - half);
    const east  = latlng.lng + half;
    const west  = latlng.lng - half;

    mapState.pickedBounds = { north, south, east, west };

    // Remove old rectangle
    if (mapState.rectangle) {
        mapState.leaflet.removeLayer(mapState.rectangle);
    }

    // Draw new rectangle
    mapState.rectangle = L.rectangle(
        [[south, west], [north, east]],
        {
            color: '#4ecdc4',
            weight: 2,
            fillColor: '#4ecdc4',
            fillOpacity: 0.12,
            dashArray: '6 4'
        }
    ).addTo(mapState.leaflet);

    // Update info panel
    const latDir = latlng.lat >= 0 ? 'N' : 'S';
    const lonDir = latlng.lng >= 0 ? 'E' : 'W';
    const latStr = Math.abs(latlng.lat).toFixed(4) + '°' + latDir;
    const lonStr = Math.abs(latlng.lng).toFixed(4) + '°' + lonDir;

    // Rough area estimate in km²
    const latKm = (north - south) * 111;
    const lonKm = (east - west) * 111 * Math.cos(latlng.lat * Math.PI / 180);
    const areaKm = Math.round(latKm * lonKm);

    document.getElementById('map-coords-display').textContent = `📍 ${latStr}, ${lonStr}`;
    document.getElementById('map-area-display').textContent = `~${areaKm.toLocaleString()} km²`;
    document.getElementById('map-location-info').classList.remove('hidden');
    document.getElementById('confirm-map-btn').disabled = false;
}

function onMapClick(e) {
    mapState.pickedLatLng = e.latlng;

    // Remove old marker
    if (mapState.clickMarker) {
        mapState.leaflet.removeLayer(mapState.clickMarker);
    }

    // Add a pulsing circle marker
    mapState.clickMarker = L.circleMarker(e.latlng, {
        radius: 6,
        color: '#ff6b6b',
        fillColor: '#ff6b6b',
        fillOpacity: 0.9,
        weight: 2
    }).addTo(mapState.leaflet);

    drawBoundingBox(e.latlng);
}

async function confirmMapPick() {
    if (!mapState.pickedBounds) return;

    closeMapPicker();

    const bounds = mapState.pickedBounds;
    const latlng = mapState.pickedLatLng;

    // Set global state
    state.bounds = bounds;
    state.fileId = `map-${latlng.lat.toFixed(4)}-${latlng.lng.toFixed(4)}`;

    // Update bounds inputs (for reference)
    document.getElementById('north').value = bounds.north.toFixed(4);
    document.getElementById('south').value = bounds.south.toFixed(4);
    document.getElementById('east').value  = bounds.east.toFixed(4);
    document.getElementById('west').value  = bounds.west.toFixed(4);

    // Show file-info row with location label
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('file-name').textContent =
        `📍 ${latlng.lat.toFixed(3)}°, ${latlng.lng.toFixed(3)}°`;
    document.getElementById('file-bounds').textContent = 'Map Pick';

    // Fetch satellite texture + DEM in parallel
    showLoading('Fetching satellite imagery...');
    setStatus('Loading map pick...', 'loading');

    try {
        // 1. Fetch satellite texture
        const satCanvas = await fetchSatelliteTiles(bounds);
        state.satCanvas = satCanvas;

        // 2. Load as Three.js texture
        const loader = new THREE.TextureLoader();
        state.colorTexture = loader.load(satCanvas.toDataURL(), () => {
            // Max anisotropic filtering
            state.colorTexture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
            state.colorTexture.needsUpdate = true;
            
            // Flat terrain first
            createTerrain();
            document.getElementById('view-section').classList.remove('hidden');
            document.getElementById('lighting-section').classList.remove('hidden');
            document.getElementById('voice-section').classList.remove('hidden');
            document.getElementById('terrain-section').classList.remove('hidden');
            document.getElementById('bounds-section').classList.add('hidden');
            updateStepNumbers();
        });

        // 3. Fetch DEM (reuses existing function)
        showLoading('Fetching elevation data...');
        setStatus('Fetching DEM...', 'loading');
        await fetchDEM();

        setStatus(`📍 ${latlng.lat.toFixed(3)}°, ${latlng.lng.toFixed(3)}° — terrain ready!`, 'success');

    } catch (err) {
        hideLoading();
        setStatus('Map pick error: ' + err.message, 'error');
        console.error(err);
    }
}

async function fetchSatelliteTiles(bounds) {
    const style = document.getElementById('map-style-select').value;
    let TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    if (style === 'hybrid') {
        // High-definition Google Hybrid layer: satellite photo + highways + roads + bridges + names!
        TILE_URL = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
    }
    
    const latSpan = Math.abs(bounds.north - bounds.south);
    // Dynamically calculate optimal zoom to keep grid size around 3x3 to 5x5 tiles
    let zoom = Math.floor(Math.log2(1800 / latSpan));
    zoom = Math.max(3, Math.min(zoom, 13));
    
    const tileSize = 256;

    const { north, south, east, west } = bounds;

    const minTile = latLonToTile(north, west, zoom);
    const maxTile = latLonToTile(south, east, zoom);

    const xMin = Math.min(minTile.x, maxTile.x);
    const xMax = Math.max(minTile.x, maxTile.x);
    const yMin = Math.min(minTile.y, maxTile.y);
    const yMax = Math.max(minTile.y, maxTile.y);

    // Clamp to a reasonable number of tiles (max 6×6)
    const clampedXMax = Math.min(xMax, xMin + 5);
    const clampedYMax = Math.min(yMax, yMin + 5);

    const width  = (clampedXMax - xMin + 1) * tileSize;
    const height = (clampedYMax - yMin + 1) * tileSize;

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill with a dark fallback color
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(0, 0, width, height);

    // Fetch all tiles in parallel
    const tilePromises = [];
    for (let y = yMin; y <= clampedYMax; y++) {
        for (let x = xMin; x <= clampedXMax; x++) {
            const url = TILE_URL.replace('{z}', zoom).replace('{y}', y).replace('{x}', x);
            tilePromises.push(
                loadImage(url)
                    .then(img => ({ img, dx: (x - xMin) * tileSize, dy: (y - yMin) * tileSize }))
                    .catch(() => null)
            );
        }
    }

    const tiles = await Promise.all(tilePromises);
    for (const t of tiles) {
        if (t?.img) ctx.drawImage(t.img, t.dx, t.dy);
    }

    // Crop to exact bounds
    const tileBoundsNW = tileToLatLon(xMin, yMin, zoom);
    const tileBoundsSE = tileToLatLon(clampedXMax + 1, clampedYMax + 1, zoom);

    const totalW = width;
    const totalH = height;

    const cropX = ((west - tileBoundsNW.lon) / (tileBoundsSE.lon - tileBoundsNW.lon)) * totalW;
    const cropY = ((tileBoundsNW.lat - north) / (tileBoundsNW.lat - tileBoundsSE.lat)) * totalH;
    const cropW = ((east - west) / (tileBoundsSE.lon - tileBoundsNW.lon)) * totalW;
    const cropH = ((north - south) / (tileBoundsNW.lat - tileBoundsSE.lat)) * totalH;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width  = 512;
    finalCanvas.height = 512;
    finalCanvas.getContext('2d').drawImage(
        canvas,
        Math.max(0, cropX), Math.max(0, cropY),
        Math.max(1, cropW), Math.max(1, cropH),
        0, 0, 512, 512
    );

    return finalCanvas;
}

// ===========================================
// CAMERA CONTROLS
// ===========================================
function updateOrbitCamera() {
    state.camera.position.x = state.orbitRadius * Math.sin(state.orbitPhi) * Math.cos(state.orbitAngle);
    state.camera.position.y = state.orbitRadius * Math.cos(state.orbitPhi);
    state.camera.position.z = state.orbitRadius * Math.sin(state.orbitPhi) * Math.sin(state.orbitAngle);
    state.camera.lookAt(0, 0, 0);
}

function getGeoPosition() {
    if (!state.bounds) return null;

    const pos = state.planeMode ? state.plane.position : state.camera.position;
    const terrainSize = 100;

    // Convert world coords to 0-1 UV
    const u = (pos.x + terrainSize / 2) / terrainSize;
    const v = (pos.z + terrainSize / 2) / terrainSize;

    // Map to geo coordinates
    const lat = state.bounds.north - v * (state.bounds.north - state.bounds.south);
    const lon = state.bounds.west + u * (state.bounds.east - state.bounds.west);
    const altitude = Math.max(0, pos.y * 50);

    return { lat, lon, altitude };
}

function toggleFlyMode() {
    state.cameraMode = state.cameraMode === 'orbit' ? 'fly' : 'orbit';

    if (state.cameraMode === 'fly') {
        // Enter plane mode
        state.planeMode = true;
        if (state.plane) {
            state.plane.visible = true;
            // Position plane above terrain center, wrapper at identity rotation
            state.plane.position.set(0, 20, 0);
            state.plane.rotation.set(0, 0, 0);
        }
        if (state.planeAudio) {
            state.planeAudio.currentTime = 0;
            state.planeAudio.play();
        }
        document.getElementById('fly-btn').textContent = 'Exit Plane Mode';
    } else {
        // Exit plane mode
        state.planeMode = false;
        if (state.plane) {
            state.plane.visible = false;
        }
        if (state.planeAudio) {
            state.planeAudio.pause();
        }
        document.getElementById('fly-btn').textContent = '✈️ Fly Plane';
        updateOrbitCamera();
    }
}

async function toggleVoiceChat() {
    const btn = document.getElementById('voice-btn');
    const status = document.getElementById('voice-status');

    if (VoiceChat.isActive()) {
        VoiceChat.stop();
        btn.textContent = '🎤 Start Voice Chat';
        btn.classList.remove('active');
        status.classList.add('hidden');
        if (state.planeAudio) {
            state.planeAudio.muted = false;
        }
    } else {
        try {
            btn.textContent = 'Connecting...';
            btn.disabled = true;

            // Fetch API key
            const resp = await fetch('/api/gemini-key');
            if (!resp.ok) throw new Error('Failed to get API key');
            const { key } = await resp.json();

            // Get map name from filename
            const mapName = document.getElementById('file-name')?.textContent || 'terrain';

            // Initialize and start
            VoiceChat.init(key, mapName, state.bounds, getGeoPosition);
            await VoiceChat.start();

            btn.textContent = '🔴 Stop Voice Chat';
            btn.classList.add('active');
            btn.disabled = false;
            status.classList.remove('hidden');
            if (state.planeAudio) {
                state.planeAudio.muted = true;
            }
        } catch (err) {
            console.error('Voice chat error:', err);
            setStatus('Voice chat failed: ' + err.message, 'error');
            btn.textContent = '🎤 Start Voice Chat';
            btn.disabled = false;
        }
    }
}

// ===========================================
// ANIMATION
// ===========================================
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    // Auto-rotate in orbit mode
    if (state.cameraMode === 'orbit' && !state.isDragging) {
        const speed = parseFloat(document.getElementById('rotation').value) / 100;
        state.orbitAngle += 0.003 * speed;
        updateOrbitCamera();
    }

    // Plane mode flight
    if (state.cameraMode === 'fly' && state.planeMode && state.plane) {
        const turnSpeed = 1.2;
        const pitchSpeed = 0.8;
        const forwardSpeed = 3;
        const bankAngle = 0.5;

        // Yaw (turn left/right)
        if (state.keys['KeyA']) state.plane.rotation.y += turnSpeed * delta;
        if (state.keys['KeyD']) state.plane.rotation.y -= turnSpeed * delta;

        // Pitch (nose up/down)
        if (state.keys['KeyW']) state.plane.rotation.x -= pitchSpeed * delta;
        if (state.keys['KeyS']) state.plane.rotation.x += pitchSpeed * delta;

        // Bank when turning (visual roll) - auto-levels when released
        let targetBank = 0;
        if (state.keys['KeyA']) targetBank = bankAngle;
        if (state.keys['KeyD']) targetBank = -bankAngle;
        state.plane.rotation.z = THREE.MathUtils.lerp(state.plane.rotation.z, targetBank, 0.15);

        // Move plane forward in its facing direction
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(state.plane.quaternion);
        state.plane.position.addScaledVector(direction, forwardSpeed * delta);

        // Check collision with terrain or out of bounds
        const pos = state.plane.position;
        const bounds = 50;
        let shouldReset = Math.abs(pos.x) > bounds || Math.abs(pos.z) > bounds;

        // Raycast to detect terrain height
        if (!shouldReset && state.terrain) {
            const raycaster = new THREE.Raycaster();
            raycaster.set(
                new THREE.Vector3(pos.x, 100, pos.z),
                new THREE.Vector3(0, -1, 0)
            );
            const intersects = raycaster.intersectObject(state.terrain);
            if (intersects.length > 0) {
                const terrainHeight = intersects[0].point.y;
                if (pos.y < terrainHeight + 0.5) {
                    shouldReset = true;
                }
            }
        }

        if (shouldReset) {
            state.plane.position.set(0, 20, 0);
            state.plane.rotation.set(0, 0, 0);
        }

        // Camera follows behind plane
        const cameraOffset = new THREE.Vector3(0, 3, 8);
        cameraOffset.applyQuaternion(state.plane.quaternion);
        state.camera.position.copy(state.plane.position).add(cameraOffset);
        state.camera.lookAt(state.plane.position);
    }

    state.renderer.render(state.scene, state.camera);
}

// ===========================================
// UTILITIES
// ===========================================
function setStatus(msg, type = '') {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = type;
}

function showLoading(text) {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// ===========================================
// START
// ===========================================
init();
