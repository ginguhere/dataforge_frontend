import { useEffect, useRef, useState } from "react";
import "./App.css";

const BACKEND_URL = "http://localhost:7860";



function App() {
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const dataChannelRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Ready");
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState("READY");

  const [transcript, setTranscript] = useState(
    "Start a voice session to begin."
  );

  const [logs, setLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);

  //mouse tracking

  useEffect(() => {
    const handleMouseMove = (event) => {
      document.documentElement.style.setProperty(
        "--mouse-x",
        `${event.clientX}px`
      );

      document.documentElement.style.setProperty(
        "--mouse-y",
        `${event.clientY}px`
      );
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);


  /* =========================
     LOGGING
  ========================= */

  function addLog(type, message) {
    const now = new Date();

    const time = now.toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    setLogs((prev) => [
      ...prev.slice(-30),
      {
        time,
        type,
        message,
      },
    ]);
  }

  /* =========================
     RTVI MESSAGE HANDLING
  ========================= */

  function handleRTVIMessage(rawMessage) {
    console.log("RTVI message:", rawMessage);

    let message;

    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    /*
      Different Pipecat/RTVI versions can expose slightly
      different event names. We intentionally handle the
      common transcript/status forms here.
    */

    const type =
      message.type ||
      message.event ||
      message.name ||
      "";

    const data =
      message.data ||
      message.payload ||
      message;

    const lowerType = String(type).toLowerCase();

    /* USER TRANSCRIPT */

    if (
      lowerType.includes("user") &&
      (lowerType.includes("transcript") ||
        lowerType.includes("transcription"))
    ) {
      const text =
        data.text ||
        data.transcript ||
        data.content ||
        message.text ||
        message.transcript;

      if (text) {
        setTranscript(text);
        setActivity("LISTENING");
        setStatus("Hearing you");

        addLog("STT", text);
      }

      return;
    }

    /* BOT / ASSISTANT TRANSCRIPT */

    if (
      (lowerType.includes("bot") ||
        lowerType.includes("assistant")) &&
      (lowerType.includes("transcript") ||
        lowerType.includes("transcription"))
    ) {
      const text =
        data.text ||
        data.transcript ||
        data.content ||
        message.text ||
        message.transcript;

      if (text) {
        setTranscript(text);
        setActivity("SPEAKING");
        setStatus("Rime voice output");

        addLog("RIME", text);
      }

      return;
    }

    /* USER STARTED SPEAKING */

    if (
      lowerType.includes("user-started-speaking") ||
      lowerType.includes("user_started_speaking")
    ) {
      setActivity("LISTENING");
      setStatus("Listening");

      addLog("VOICE", "User started speaking");
      return;
    }

    /* USER STOPPED SPEAKING */

    if (
      lowerType.includes("user-stopped-speaking") ||
      lowerType.includes("user_stopped_speaking")
    ) {
      setActivity("UNDERSTANDING");
      setStatus("Processing your request");

      addLog("VOICE", "User stopped speaking");
      return;
    }

    /* BOT STARTED SPEAKING */

    if (
      lowerType.includes("bot-started-speaking") ||
      lowerType.includes("bot_started_speaking")
    ) {
      setActivity("SPEAKING");
      setStatus("Speaking");

      addLog("RIME", "Speech started");
      return;
    }

    /* BOT STOPPED SPEAKING */

    if (
      lowerType.includes("bot-stopped-speaking") ||
      lowerType.includes("bot_stopped_speaking")
    ) {
      setActivity("LISTENING");
      setStatus("Ready for your next request");

      addLog("RIME", "Speech finished");
      return;
    }

    /* INTERRUPTION */

    if (
      lowerType.includes("interrupt") ||
      lowerType.includes("interrupted")
    ) {
      setActivity("INTERRUPTED");
      setStatus("Request interrupted");

      addLog("VOICE", "User interrupted the response");

      setTimeout(() => {
        if (pcRef.current?.connectionState === "connected") {
          setActivity("LISTENING");
          setStatus("Listening");
        }
      }, 500);

      return;
    }

    /* FUNCTION / TOOL */

    if (
      lowerType.includes("function") ||
      lowerType.includes("tool")
    ) {
      addLog("TOOL", message.function_name || message.name || "Tool event");

      if (
        lowerType.includes("start") ||
        lowerType.includes("call")
      ) {
        setActivity("RETRIEVING DATA");
        setStatus("Retrieving data");
      }

      return;
    }

    /* CANCELLED */

    if (
      lowerType.includes("cancel") ||
      lowerType.includes("stopped")
    ) {
      if (message.cancelled === true || data.cancelled === true) {
        setActivity("RECOVERING");
        setStatus("Previous request cancelled");

        addLog("TOOL", "Previous operation cancelled");

        setTimeout(() => {
          if (pcRef.current?.connectionState === "connected") {
            setActivity("LISTENING");
            setStatus("Listening");
          }
        }, 500);
      }

      return;
    }
  }

  /* =========================
     START VOICE
  ========================= */

  async function startVoice() {
    try {
      setStatus("Requesting microphone...");
      setActivity("CONNECTING");

      addLog("SYSTEM", "Requesting microphone");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      streamRef.current = stream;

      setStatus("Creating realtime connection...");

      addLog("WEBRTC", "Creating realtime connection");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const dataChannel = pc.createDataChannel("rtvi");
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log("RTVI data channel opened");

        setStatus("Voice connection active");
        setActivity("LISTENING");

        addLog("RTVI", "Data channel connected");
      };

      dataChannel.onclose = () => {
        console.log("RTVI data channel closed");

        addLog("RTVI", "Data channel closed");
      };

      dataChannel.onerror = (error) => {
        console.error("RTVI data channel error:", error);

        setStatus("Voice channel error");
        setActivity("ERROR");

        addLog("ERROR", "RTVI data channel error");
      };

      dataChannel.onmessage = (event) => {
        handleRTVIMessage(event.data);
      };

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      /* =========================
         AUDIO OUTPUT
      ========================= */

      pc.ontrack = (event) => {
        console.log("Received audio track");

        addLog("RIME", "Audio stream received");

        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];

          audioRef.current
            .play()
            .catch((error) => {
              console.error("Audio playback failed:", error);
              addLog("ERROR", "Audio playback failed");
            });
        }
      };

      /* =========================
         CONNECTION STATE
      ========================= */

      pc.onconnectionstatechange = () => {
        console.log("WebRTC:", pc.connectionState);

        if (pc.connectionState === "connected") {
          setStatus("Voice connection active");
          setConnected(true);
          setActivity("LISTENING");

          addLog("WEBRTC", "Connection established");
        }

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          setStatus("Disconnected");
          setConnected(false);
          setActivity("IDLE");

          addLog("WEBRTC", `Connection ${pc.connectionState}`);
        }
      };

      /* =========================
         SDP
      ========================= */

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener(
              "icegatheringstatechange",
              checkState
            );

            resolve();
          }
        };

        pc.addEventListener(
          "icegatheringstatechange",
          checkState
        );
      });

      addLog("WEBRTC", "Sending SDP offer");

      const response = await fetch(`${BACKEND_URL}/api/offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      });

      if (!response.ok) {
        const text = await response.text();

        throw new Error(
          `Backend returned ${response.status}: ${text}`
        );
      }

      const answer = await response.json();

      addLog("WEBRTC", "Received SDP answer");

      await pc.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      setStatus("Voice connection active");
      setConnected(true);
      setActivity("LISTENING");

      addLog("SYSTEM", "DataForge is ready");
    } catch (error) {
      console.error("Voice connection error:", error);

      setStatus(`Error: ${error.message}`);
      setConnected(false);
      setActivity("ERROR");

      addLog("ERROR", error.message);
    }
  }

  /* =========================
     STOP VOICE
  ========================= */

  function stopVoice() {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });

      streamRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }

    setConnected(false);
    setStatus("Ready");
    setActivity("READY");
    setTranscript("Start a voice session to begin.");

    addLog("SYSTEM", "Voice session ended");
  }

  /* =========================
     CLEANUP
  ========================= */

  useEffect(() => {
    return () => {
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
      }

      if (pcRef.current) {
        pcRef.current.close();
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, []);

  /* =========================
     UI
  ========================= */

  return (
    <div className="app">

      <audio ref={audioRef} autoPlay />

      {/* TOP BAR */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-mark">
            D
          </div>

          <div>
            <div className="brand-name">
              DATAFORGE
            </div>

            <div className="brand-subtitle">
              VOICE INTELLIGENCE
            </div>
          </div>

        </div>

        <div className="topbar-right">

          <div className="engine">
            <span className="engine-dot" />
            RIME / GROQ
          </div>

          <div
            className={`connection ${connected ? "online" : ""
              }`}
          >
            <span />
            {connected ? "CONNECTED" : "OFFLINE"}
          </div>

        </div>

      </header>


      {/* MAIN */}

      <main className="main">

        <section className="hero">

          <div className="eyebrow">
            REALTIME VOICE INTERFACE
          </div>

          <h1>
            Voice,
            <br />
            <span>with context.</span>
          </h1>

          <p className="hero-description">
            Ask naturally. Interrupt freely.
            DataForge keeps up.
          </p>


          {/* VOICE */}

          <div className="voice-area">

            <div
              className={`voice-orbit ${connected ? "active" : ""
                }`}
            >

              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />

              <button
                className={`voice-button ${connected ? "connected" : ""
                  }`}
                onClick={
                  connected ? stopVoice : startVoice
                }
              >

                <div className="voice-icon">
                  {connected ? "■" : "●"}
                </div>

                <span>
                  {connected
                    ? "STOP"
                    : "START VOICE"}
                </span>

              </button>

            </div>


            {/* DYNAMIC STATUS */}

            <div className="activity">

              <span
                className={`activity-dot ${connected ? "pulse" : ""
                  }`}
              />

              <span>
                {activity}
              </span>

            </div>

            <div className="status">
              {status}
            </div>


            {/* LIVE TRANSCRIPT */}

            <div className="transcript">

              <span className="transcript-label">
                LIVE
              </span>

              <span className="transcript-text">
                {transcript}
              </span>

            </div>

          </div>

        </section>

      </main>


      {/* LIVE LOG */}

      <div className="log-wrapper">

        {logsOpen && (
          <div className="log-panel">

            {logs.length === 0 ? (
              <div className="log-entry">
                <span className="log-text">
                  Waiting for activity...
                </span>
              </div>
            ) : (
              logs.map((log, index) => (
                <div
                  className="log-entry"
                  key={index}
                >
                  <span className="log-time">
                    {log.time}
                  </span>

                  <span className="log-type">
                    {log.type}
                  </span>

                  <span className="log-text">
                    {log.message}
                  </span>
                </div>
              ))
            )}

          </div>
        )}

        <div
          className="log-bar"
          onClick={() =>
            setLogsOpen((open) => !open)
          }
        >

          <div className="log-left">

            <span className="log-dot" />

            <span className="log-message">
              {logs.length > 0
                ? `${logs[logs.length - 1].type} · ${logs[logs.length - 1].message
                }`
                : "LIVE LOG · READY"}
            </span>

          </div>

          <span className="log-toggle">
            {logsOpen ? "⌄" : "⌃"}
          </span>

        </div>

      </div>

    </div>
  );
}

export default App;