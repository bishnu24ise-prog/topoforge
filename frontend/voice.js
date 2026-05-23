/**
 * Voice Chat Module — AI Tour Guide
 * Handles bidirectional audio streaming with Gemini as a tour guide
 */

const VoiceChat = (function() {
    // Private state
    let ws = null;
    let audioContext = null;
    let mediaStream = null;
    let sourceNode = null;
    let workletNode = null;
    let active = false;
    let setupComplete = false;
    let positionInterval = null;

    // Config
    let apiKey = null;
    let mapName = null;
    let bounds = null;
    let getPositionFn = null;

    // Audio config
    const SEND_SAMPLE_RATE = 16000;
    const RECEIVE_SAMPLE_RATE = 24000;
    const BUFFER_SIZE = 4096;

    // Playback state
    let playbackQueue = [];
    let isPlaying = false;
    let nextPlayTime = 0;
    let currentSource = null;

    /**
     * Build system prompt with map context
     */
    function buildSystemPrompt() {
        const pos = getPositionFn ? getPositionFn() : null;
        let prompt = `You are a friendly and knowledgeable tour guide flying over ${mapName || 'terrain'}.

Geographic bounds of this map:
- North: ${bounds?.north?.toFixed(4) || 'unknown'}°
- South: ${bounds?.south?.toFixed(4) || 'unknown'}°
- East: ${bounds?.east?.toFixed(4) || 'unknown'}°
- West: ${bounds?.west?.toFixed(4) || 'unknown'}°`;

        if (pos) {
            prompt += `

Current flight position: ${pos.lat.toFixed(4)}° latitude, ${pos.lon.toFixed(4)}° longitude, at approximately ${Math.round(pos.altitude)} meters altitude.`;
        }

        prompt += `

Your role:
- Share interesting facts about the terrain, geography, history, and landmarks visible in this area
- Keep responses brief and conversational (1-2 sentences typically)
- Respond naturally to questions about what the user can see
- Be enthusiastic but not over the top
- If you don't know specific details about an area, share general geographic or geological facts that would apply`;

        return prompt;
    }

    /**
     * Connect to AI voice service WebSocket
     */
    function connectWebSocket() {
        return new Promise((resolve, reject) => {
            const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('[Voice] WebSocket connected');
                sendSetupMessage();
            };

            ws.onmessage = async (event) => {
                let data = event.data;

                // Handle Blob data (binary responses from Gemini)
                if (data instanceof Blob) {
                    data = await data.text();
                }

                handleServerMessage(data);
                if (!setupComplete) {
                    setupComplete = true;
                    resolve();
                }
            };

            ws.onerror = (error) => {
                console.error('[Voice] WebSocket error:', error);
                reject(error);
            };

            ws.onclose = (event) => {
                console.log('[Voice] WebSocket closed:', event.code, event.reason);
                if (active) {
                    stop();
                }
            };

            // Timeout for connection
            setTimeout(() => {
                if (!setupComplete) {
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Send setup message to configure the session
     */
    function sendSetupMessage() {
        const setupMsg = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Puck" // High-fidelity, exceptionally warm, clear, and articulate human voice!
                            }
                        }
                    },
                    temperature: 0.5, // Faster, more decisive response generation
                    maxOutputTokens: 300 // Concise, snappy tour-guide descriptions suitable for real-time flight simulation
                },
                systemInstruction: {
                    parts: [{ text: buildSystemPrompt() }]
                }
            }
        };

        ws.send(JSON.stringify(setupMsg));
        console.log('[Voice] Setup message sent');
    }

    /**
     * Handle incoming server messages
     */
    function handleServerMessage(data) {
        try {
            const msg = JSON.parse(data);

            if (msg.setupComplete) {
                console.log('[Voice] Setup complete');
                return;
            }

            if (msg.serverContent?.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.inlineData?.data) {
                        // Queue audio for playback
                        playbackQueue.push(part.inlineData.data);
                        processPlaybackQueue();
                    }
                }
            }

            if (msg.serverContent?.turnComplete) {
                console.log('[Voice] Turn complete');
            }
        } catch (e) {
            console.error('[Voice] Error parsing message:', e);
        }
    }

    /**
     * Start microphone capture using AudioWorklet
     */
    async function startMicCapture() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: { ideal: SEND_SAMPLE_RATE },
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SEND_SAMPLE_RATE
            });

            // Load AudioWorklet module
            await audioContext.audioWorklet.addModule('./audio-processor.js');

            sourceNode = audioContext.createMediaStreamSource(mediaStream);
            workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');

            // Handle audio data from worklet with a high-performance local noise gate VAD!
            let silentFramesCount = 0;
            const SILENCE_THRESHOLD = 0.006; // Highly sensitive threshold to catch soft speech but block hum
            
            workletNode.port.onmessage = (event) => {
                if (!active || !ws || ws.readyState !== WebSocket.OPEN) return;

                const inputData = event.data;

                // Basic voice activity detection
                let maxAmp = 0;
                for (let i = 0; i < inputData.length; i++) {
                    maxAmp = Math.max(maxAmp, Math.abs(inputData[i]));
                }
                
                // Noise-gate VAD filter: ignore fan hums, AC noise, breathing, and mic static
                if (maxAmp < SILENCE_THRESHOLD) {
                    silentFramesCount++;
                    // Skip streaming once silence is established to let Gemini detect natural turn endings
                    if (silentFramesCount > 6) {
                        return;
                    }
                } else {
                    silentFramesCount = 0; // Reset instantly when active voice is detected
                }

                // If user speaks while guide is speaking, interrupt the guide instantly
                if (maxAmp > 0.02 && (isPlaying || playbackQueue.length > 0)) {
                    interrupt();
                }

                // Resample if needed
                const outputData = resampleAudio(inputData, audioContext.sampleRate, SEND_SAMPLE_RATE);

                // Convert to Int16 PCM
                const pcmData = float32ToInt16(outputData);

                // Convert to base64
                const base64Data = arrayBufferToBase64(pcmData.buffer);

                // Send to Gemini
                sendAudioChunk(base64Data);
            };

            sourceNode.connect(workletNode);

            console.log('[Voice] Microphone capture started (AudioWorklet)');
        } catch (e) {
            console.error('[Voice] Mic capture error:', e);
            throw e;
        }
    }

    /**
     * Resample audio from source rate to target rate
     */
    function resampleAudio(inputData, sourceRate, targetRate) {
        if (sourceRate === targetRate) {
            return inputData;
        }

        const ratio = sourceRate / targetRate;
        const outputLength = Math.floor(inputData.length / ratio);
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
            const t = srcIndex - srcIndexFloor;

            // Linear interpolation
            output[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
        }

        return output;
    }

    /**
     * Convert Float32Array to Int16Array (PCM)
     */
    function float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    /**
     * Convert ArrayBuffer to base64 string (chunked for performance)
     */
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid call stack limits
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
        }
        return btoa(binary);
    }

    /**
     * Convert base64 string to ArrayBuffer
     */
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Send audio chunk to Gemini
     */
    function sendAudioChunk(base64Data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const msg = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: `audio/pcm;rate=${SEND_SAMPLE_RATE}`,
                    data: base64Data
                }]
            }
        };

        ws.send(JSON.stringify(msg));
    }

    /**
     * Send position update to Gemini
     */
    function sendPositionUpdate() {
        if (!ws || ws.readyState !== WebSocket.OPEN || !getPositionFn) return;

        const pos = getPositionFn();
        if (!pos) return;

        const msg = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{
                        text: `[Position update: ${pos.lat.toFixed(4)}°, ${pos.lon.toFixed(4)}°, ${Math.round(pos.altitude)}m altitude]`
                    }]
                }],
                turnComplete: true
            }
        };
        ws.send(JSON.stringify(msg));
        console.log('[Voice] Position update sent');
    }

    /**
     * Interrupt ongoing playback (when user starts speaking)
     */
    function interrupt() {
        playbackQueue = [];
        nextPlayTime = 0;
        isPlaying = false;
        if (currentSource) {
            try {
                currentSource.stop();
            } catch (e) {
                // Already stopped
            }
            currentSource = null;
        }
    }

    /**
     * Process playback queue
     */
    function processPlaybackQueue() {
        if (isPlaying || playbackQueue.length === 0) return;

        isPlaying = true;
        const base64Data = playbackQueue.shift();
        playAudioChunk(base64Data);
    }

    /**
     * Play audio chunk from base64 PCM data
     */
    function playAudioChunk(base64Data) {
        try {
            // Ensure we have an audio context for playback
            if (!audioContext || audioContext.state === 'closed') {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Resume if suspended
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            // Decode base64 to ArrayBuffer
            const arrayBuffer = base64ToArrayBuffer(base64Data);

            // Convert to Int16 view
            const int16Data = new Int16Array(arrayBuffer);

            // Convert Int16 to Float32
            const float32Data = new Float32Array(int16Data.length);
            for (let i = 0; i < int16Data.length; i++) {
                float32Data[i] = int16Data[i] / 32768.0;
            }

            // Create audio buffer at receive sample rate
            const audioBuffer = audioContext.createBuffer(1, float32Data.length, RECEIVE_SAMPLE_RATE);
            audioBuffer.getChannelData(0).set(float32Data);

            // Create and play source
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            currentSource = source;

            // Schedule playback
            const currentTime = audioContext.currentTime;
            let startTime = Math.max(currentTime, nextPlayTime);
            
            // Anti-lag: Reset scheduling if network hiccups drift the scheduled time too far into the future!
            if (startTime - currentTime > 0.25) {
                startTime = currentTime;
            }
            source.start(startTime);

            // Update next play time for seamless playback
            nextPlayTime = startTime + audioBuffer.duration;

            source.onended = () => {
                currentSource = null;
                isPlaying = false;
                processPlaybackQueue();
            };
        } catch (e) {
            console.error('[Voice] Playback error:', e);
            currentSource = null;
            isPlaying = false;
            processPlaybackQueue();
        }
    }

    /**
     * Stop microphone capture
     */
    function stopMicCapture() {
        if (workletNode) {
            workletNode.disconnect();
            workletNode = null;
        }

        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        console.log('[Voice] Microphone capture stopped');
    }

    // Public API
    return {
        /**
         * Initialize voice chat with configuration
         */
        init(key, name, mapBounds, positionFn) {
            apiKey = key;
            mapName = name;
            bounds = mapBounds;
            getPositionFn = positionFn;
            console.log('[Voice] Initialized for', mapName);
        },

        /**
         * Start voice chat session
         */
        async start() {
            if (active) {
                console.warn('[Voice] Already active');
                return;
            }

            try {
                active = true;
                setupComplete = false;
                playbackQueue = [];
                isPlaying = false;
                nextPlayTime = 0;

                await connectWebSocket();
                await startMicCapture();

                // Start position update interval (every 60s)
                positionInterval = setInterval(sendPositionUpdate, 60000);

                console.log('[Voice] Started successfully');
            } catch (e) {
                active = false;
                throw e;
            }
        },

        /**
         * Stop voice chat session
         */
        stop() {
            active = false;
            setupComplete = false;

            // Clear position update interval
            if (positionInterval) {
                clearInterval(positionInterval);
                positionInterval = null;
            }

            stopMicCapture();

            if (ws) {
                ws.close();
                ws = null;
            }

            // Clear playback
            playbackQueue = [];
            isPlaying = false;

            console.log('[Voice] Stopped');
        },

        /**
         * Check if voice chat is active
         */
        isActive() {
            return active;
        },

        /**
         * Update position context (for future use)
         */
        updatePosition() {
            // Could send text message with updated position
            // For now, position is included in initial system prompt
        }
    };
})();
