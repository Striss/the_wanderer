import { useEffect, useRef, useState } from "react";

const WS_URL = process.env.REACT_APP_WS_URL ||
  (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host;

const RECONNECT_DELAY = 2500;

export function useWandererSocket({ onState, onBoostEvent, onOnlineCount, onChatMsg, onHello, onFeedEvent, onFeedResult, onMilestone, onReset }) {
  const wsRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const mountedRef     = useRef(false);
  const [connected, setConnected] = useState(false);

  const cbRef = useRef({});
  cbRef.current = { onState, onBoostEvent, onOnlineCount, onChatMsg, onHello, onFeedEvent, onFeedResult, onMilestone, onReset };

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;
      if (wsRef.current && wsRef.current.readyState <= 1) return;

      let ws;
      try { ws = new WebSocket(WS_URL); } catch {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
        clearTimeout(reconnectTimer.current);
      };

      ws.onmessage = (e) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(e.data);
          const cb = cbRef.current;
          switch (msg.type) {
            case "HELLO":        cb.onHello?.(msg);             break;
            case "STATE":        cb.onState?.(msg);             break;
            case "BOOST_EVENT":  cb.onBoostEvent?.(msg);        break;
            case "ONLINE_COUNT": cb.onOnlineCount?.(msg.count); break;
            case "CHAT_MSG":     cb.onChatMsg?.(msg.msg);       break;
            case "FEED_EVENT":   cb.onFeedEvent?.(msg);         break;
            case "FEED_RESULT":  cb.onFeedResult?.(msg);        break;
            case "MILESTONE":    cb.onMilestone?.(msg);         break;
            case "RESET":        cb.onReset?.(msg);             break;
            default: break;
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, []);

  const sendBoost = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "BOOST" }));
  };

  const sendFeed = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "FEED" }));
  };

  const sendChat = (text) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "CHAT", text }));
  };

  return { sendBoost, sendFeed, sendChat, connected };
}
