import { useEffect, useRef, useState } from "react";

const WS_URL = (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host;
const RECONNECT_DELAY = 3000;

export function useWandererSocket({
  onHello, onState, onMyBoost, onBoostEvent, onBoostCapped,
  onFeedEvent, onFeedResult, onMilestone, onReset, onOnlineCount,
}) {
  const cbRef  = useRef({});
  const wsRef  = useRef(null);
  const [connected, setConnected] = useState(false);

  cbRef.current = {
    onHello, onState, onMyBoost, onBoostEvent, onBoostCapped,
    onFeedEvent, onFeedResult, onMilestone, onReset, onOnlineCount,
  };

  useEffect(() => {
    let reconnectTimer = null;
    let unmounted = false;

    function connect() {
      if (wsRef.current?.readyState <= 1) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen  = () => { if (!unmounted) setConnected(true); };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const cb  = cbRef.current;
          switch (msg.type) {
            case "HELLO":        cb.onHello?.(msg);             break;
            case "STATE":        cb.onState?.(msg);             break;
            case "MY_BOOST":     cb.onMyBoost?.(msg);           break;
            case "BOOST_EVENT":  cb.onBoostEvent?.(msg);        break;
            case "BOOST_CAPPED": cb.onBoostCapped?.(msg);       break;
            case "FEED_EVENT":   cb.onFeedEvent?.(msg);         break;
            case "FEED_RESULT":  cb.onFeedResult?.(msg);        break;
            case "MILESTONE":    cb.onMilestone?.(msg);         break;
            case "RESET":        cb.onReset?.(msg);             break;
            case "ONLINE_COUNT": cb.onOnlineCount?.(msg.count); break;
            default: break;
          }
        } catch {}
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {};
    }

    connect();
    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, []);

  function sendBoost() {
    if (wsRef.current?.readyState === 1)
      wsRef.current.send(JSON.stringify({ type: "BOOST" }));
  }

  function sendFeed() {
    if (wsRef.current?.readyState === 1)
      wsRef.current.send(JSON.stringify({ type: "FEED" }));
  }

  return { sendBoost, sendFeed, connected };
}