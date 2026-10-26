/**
 * Wispr Flow Voice Command Controller for TopoForge
 * Captures microphone input, transcribes voice via Wispr Flow API,
 * and executes dynamic flight navigation and terrain styling actions.
 */

const WisprCommands = (function() {
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let recognition = null;
    let stream = null;
    let onCommandCallback = null;
    let onStateChangeCallback = null;

    /**
     * Initialize SpeechRecognition fallback for instant zero-latency recognition
     */
    function initSpeechFallback() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onresult = async (event) => {
                const text = event.results[0][0].transcript;
                console.log('[Wispr Flow Fallback STT]:', text);
                await handleCommandText(text);
            };

            recognition.onerror = (err) => {
                console.warn('[Wispr SpeechRecognition fallback error]:', err.error);
                notifyState('error', 'Microphone error: ' + err.error);
            };

            recognition.onend = () => {
                if (isRecording) {
                    stop();
                }
            };
        }
    }

    /**
     * Start recording user voice command
     */
    async function start() {
        if (isRecording) return;
        audioChunks = [];

        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isRecording = true;
            notifyState('listening', 'Listening for command...');

            // Setup MediaRecorder for Wispr Flow backend API
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
            mediaRecorder = new MediaRecorder(stream, { mimeType });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                await sendToWisprFlow(audioBlob);
            };

            mediaRecorder.start();

            // Also run browser speech recognition in parallel as instant accelerator
            if (recognition) {
                try {
                    recognition.start();
                } catch (e) {
                    // Ignore if already active
                }
            }
        } catch (err) {
            console.error('Microphone access denied or error:', err);
            notifyState('error', 'Microphone access required');
            isRecording = false;
        }
    }

    /**
     * Stop recording and process command
     */
    function stop() {
        if (!isRecording) return;
        isRecording = false;
        notifyState('processing', 'Processing command...');

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }

        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // Ignore
            }
        }
    }

    /**
     * Toggle recording state
     */
    function toggle() {
        if (isRecording) {
            stop();
        } else {
            start();
        }
    }

    /**
     * Send recorded audio to Wispr Flow backend API
     */
    async function sendToWisprFlow(blob) {
        try {
            const formData = new FormData();
            formData.append('file', blob, 'command.webm');

            const resp = await fetch('/api/wispr/transcribe', {
                method: 'POST',
                body: formData
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data.success && data.text) {
                    console.log('[Wispr Flow API Result]:', data.text);
                    executeCommand(data.command || clientParse(data.text), data.text);
                    return;
                }
            }
        } catch (err) {
            console.warn('[Wispr Flow API upload failed, falling back to local parser]:', err);
        }

        // If backend failed or wasn't configured, check if we already handled via fallback
        notifyState('idle', 'Ready');
    }

    /**
     * Handle command text via backend or client-side parser
     */
    async function handleCommandText(text) {
        notifyState('processing', `"${text}"`);

        try {
            const resp = await fetch('/api/wispr/parse-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data.success && data.command) {
                    executeCommand(data.command, text);
                    return;
                }
            }
        } catch (e) {
            // Fallback to client-side parsing
        }

        const cmd = clientParse(text);
        executeCommand(cmd, text);
    }

    /**
     * Client-side semantic intent matcher
     */
    function clientParse(text) {
        const t = (text || '').toLowerCase();

        // Flight Navigation
        if (t.includes('fly') || t.includes('plane') || t.includes('take off')) {
            if (t.includes('stop') || t.includes('exit') || t.includes('orbit')) {
                return { category: 'flight', action: 'stop_flight', feedback: 'Switched back to Orbit mode' };
            }
            return { category: 'flight', action: 'start_flight', feedback: 'Engaging Plane Flight Mode!' };
        }
        if (t.includes('faster') || t.includes('speed up') || t.includes('accelerate')) {
            return { category: 'flight', action: 'speed_up', feedback: 'Flight speed increased' };
        }
        if (t.includes('slower') || t.includes('slow down') || t.includes('brake')) {
            return { category: 'flight', action: 'slow_down', feedback: 'Flight speed eased' };
        }
        if (t.includes('climb') || t.includes('ascend') || t.includes('higher') || t.includes('altitude up')) {
            return { category: 'flight', action: 'ascend', feedback: 'Ascending to higher altitude' };
        }
        if (t.includes('dive') || t.includes('descend') || t.includes('lower') || t.includes('altitude down')) {
            return { category: 'flight', action: 'descend', feedback: 'Descending closer to terrain' };
        }

        // Texture Styles
        if (t.includes('cyberpunk') || t.includes('neon')) {
            return { category: 'style', action: 'set_style', style: 'cyberpunk', feedback: 'Applying Cyberpunk Neon preset' };
        }
        if (t.includes('vintage') || t.includes('parchment')) {
            return { category: 'style', action: 'set_style', style: 'vintage', feedback: 'Applying Vintage Parchment preset' };
        }
        if (t.includes('hypsometric') || t.includes('atlas')) {
            return { category: 'style', action: 'set_style', style: 'hypsometric', feedback: 'Applying Hypsometric Atlas preset' };
        }
        if (t.includes('emerald') || t.includes('forest') || t.includes('green')) {
            return { category: 'style', action: 'set_style', style: 'emerald', feedback: 'Applying Emerald Forest preset' };
        }
        if (t.includes('volcanic') || t.includes('lava') || t.includes('wasteland')) {
            return { category: 'style', action: 'set_style', style: 'volcanic', feedback: 'Applying Volcanic Wasteland preset' };
        }
        if (t.includes('realistic') || t.includes('clean') || t.includes('default style')) {
            return { category: 'style', action: 'set_style', style: 'realistic', feedback: 'Applying Realistic Stylish preset' };
        }
        if (t.includes('reset') && (t.includes('style') || t.includes('texture') || t.includes('color'))) {
            return { category: 'style', action: 'reset_style', feedback: 'Reset to original map imagery' };
        }

        // Lighting
        if (t.includes('sunset') || t.includes('golden hour') || t.includes('evening')) {
            return { category: 'lighting', action: 'set_lighting', azimuth: 270, elevation: 18, feedback: 'Setting lighting to Sunset' };
        }
        if (t.includes('sunrise') || t.includes('dawn')) {
            return { category: 'lighting', action: 'set_lighting', azimuth: 90, elevation: 22, feedback: 'Setting lighting to Sunrise' };
        }
        if (t.includes('noon') || t.includes('bright sun')) {
            return { category: 'lighting', action: 'set_lighting', azimuth: 180, elevation: 75, feedback: 'Setting lighting to High Noon' };
        }
        if (t.includes('reset lighting') || t.includes('normal light')) {
            return { category: 'lighting', action: 'reset_lighting', feedback: 'Reset sun lighting' };
        }

        // Elevation
        if (t.includes('elevation') || t.includes('mountains') || t.includes('peaks')) {
            if (t.includes('more') || t.includes('high') || t.includes('increase') || t.includes('tall')) {
                return { category: 'elevation', action: 'adjust_elevation', delta: 5, feedback: 'Increasing elevation vertical scale' };
            }
            if (t.includes('less') || t.includes('low') || t.includes('decrease') || t.includes('flat')) {
                return { category: 'elevation', action: 'adjust_elevation', delta: -5, feedback: 'Decreasing elevation vertical scale' };
            }
        }

        // Tour Guide & World Map
        if (t.includes('tour') || t.includes('voice chat') || t.includes('tell me about')) {
            return { category: 'tour', action: 'start_tour', feedback: 'Starting AI Tour Guide' };
        }
        if (t.includes('pick location') || t.includes('world map') || t.includes('open map')) {
            return { category: 'map', action: 'open_map_picker', feedback: 'Opening World Map Picker' };
        }

        return {
            category: 'unknown',
            action: 'none',
            feedback: `Heard: "${text}". Try "fly plane", "cyberpunk", or "sunset".`
        };
    }

    /**
     * Dispatch structured command to TopoForge application
     */
    function executeCommand(command, rawText) {
        if (!command) return;

        console.log('[Executing Voice Command]:', command);
        notifyState('success', command.feedback || `Executed: ${command.action}`, rawText);

        if (onCommandCallback) {
            onCommandCallback(command);
        }

        // Direct DOM action dispatches
        switch (command.action) {
            case 'start_flight': {
                const flyBtn = document.getElementById('fly-btn');
                if (flyBtn && flyBtn.textContent.includes('Fly')) {
                    flyBtn.click();
                }
                break;
            }
            case 'stop_flight': {
                const flyBtn = document.getElementById('fly-btn');
                if (flyBtn && flyBtn.textContent.includes('Orbit')) {
                    flyBtn.click();
                }
                break;
            }
            case 'set_style': {
                const select = document.getElementById('texture-style-select');
                if (select && command.style) {
                    select.value = command.style;
                    const stylizeBtn = document.getElementById('stylize-btn');
                    if (stylizeBtn) stylizeBtn.click();
                }
                break;
            }
            case 'reset_style': {
                const resetBtn = document.getElementById('reset-stylize-btn');
                if (resetBtn) resetBtn.click();
                break;
            }
            case 'set_lighting': {
                const azSlider = document.getElementById('sun-azimuth');
                const elSlider = document.getElementById('sun-elevation');
                if (azSlider && command.azimuth !== undefined) {
                    azSlider.value = command.azimuth;
                    azSlider.dispatchEvent(new Event('input'));
                }
                if (elSlider && command.elevation !== undefined) {
                    elSlider.value = command.elevation;
                    elSlider.dispatchEvent(new Event('input'));
                }
                break;
            }
            case 'reset_lighting': {
                const resetSunBtn = document.getElementById('reset-sun-btn');
                if (resetSunBtn) resetSunBtn.click();
                break;
            }
            case 'adjust_elevation': {
                const exag = document.getElementById('exag');
                if (exag && command.delta) {
                    const current = parseInt(exag.value, 10) || 7;
                    exag.value = Math.max(1, Math.min(80, current + command.delta));
                    exag.dispatchEvent(new Event('input'));
                }
                break;
            }
            case 'start_tour': {
                const voiceBtn = document.getElementById('voice-btn');
                if (voiceBtn && !voiceBtn.classList.contains('active')) {
                    voiceBtn.click();
                }
                break;
            }
            case 'stop_tour': {
                const voiceBtn = document.getElementById('voice-btn');
                if (voiceBtn && voiceBtn.classList.contains('active')) {
                    voiceBtn.click();
                }
                break;
            }
            case 'open_map_picker': {
                const mapBtn = document.getElementById('open-map-btn');
                if (mapBtn) mapBtn.click();
                break;
            }
        }
    }

    function notifyState(state, message, detail = '') {
        if (onStateChangeCallback) {
            onStateChangeCallback({ state, message, detail });
        }
    }

    return {
        init: function(onCommand, onStateChange) {
            onCommandCallback = onCommand;
            onStateChangeCallback = onStateChange;
            initSpeechFallback();
        },
        start,
        stop,
        toggle,
        isActive: () => isRecording,
        handleCommandText
    };
})();
