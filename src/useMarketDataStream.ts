import { useEffect, useRef } from 'react';
import { useTradeStore } from './store';

export const useMarketDataStream = (url: string) => {
  const updatePrice = useTradeStore((state) => state.updatePrice);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Standard WebSocket implementation
    socketRef.current = new WebSocket(url);

    socketRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Directly updating the store to avoid React component state lag
      updatePrice(data);
    };

    socketRef.current.onerror = (err) => console.error("WebSocket Error:", err);

    return () => {
      socketRef.current?.close();
    };
  }, [url, updatePrice]);
};
