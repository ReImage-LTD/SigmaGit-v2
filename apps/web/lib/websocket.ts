import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { getApiUrl } from "./utils";

type WebSocketMessage = {
  type: string;
  [key: string]: any;
};

type WebSocketState = "connecting" | "connected" | "disconnected" | "error";

async function fetchWsTicket(apiUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/api/ws-ticket`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: string };
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manuallyDisconnectedRef = useRef(false);
  const [state, setState] = useState<WebSocketState>("disconnected");
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  const connect = useCallback(async () => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    manuallyDisconnectedRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const session = await authClient.getSession();
      if (!session.data?.session) {
        // Session may not be ready yet; keep retrying in background.
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
        return;
      }

      const apiUrl = getApiUrl();
      const ticket = await fetchWsTicket(apiUrl);
      if (!ticket) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
        return;
      }

      const wsUrl = apiUrl.replace(/^http/, "ws");
      // Short-lived single-use ticket — never put the session token in the URL.
      const url = `${wsUrl}/ws?ticket=${encodeURIComponent(ticket)}`;

      setState("connecting");
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setState("connected");
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === "notification") {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          } else if (message.type === "workflow_job.log_chunk") {
            const { repoOwner, repoName, runId, jobId } = message;
            if (repoOwner && repoName && runId && jobId) {
              queryClient.invalidateQueries({
                queryKey: ["job-logs", repoOwner, repoName, runId, jobId],
              });
            }
          } else if (message.type === "workflow_job.status_changed") {
            const { repoOwner, repoName, runId, jobId } = message;
            if (repoOwner && repoName && runId) {
              queryClient.invalidateQueries({
                queryKey: ["workflow-run", repoOwner, repoName, runId],
              });
              queryClient.invalidateQueries({
                queryKey: ["workflow-runs", repoOwner, repoName],
              });
              if (jobId) {
                queryClient.invalidateQueries({
                  queryKey: ["job-logs", repoOwner, repoName, runId, jobId],
                });
              }
            }
          }
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        setState("disconnected");
        wsRef.current = null;
        if (manuallyDisconnectedRef.current) return;

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        setState("error");
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[WS] Connect error:", err);
      setState("error");
    }
  }, [queryClient]);

  const disconnect = useCallback(() => {
    manuallyDisconnectedRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState("disconnected");
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { state, connect, disconnect };
}
