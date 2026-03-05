import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createTerminalClient, useTerminalOutput } from "../hooks/useTerminal";

type TerminalInstanceProps = {
  sessionId: string;
  isActive: boolean;
  onTitleChange?: (title: string) => void;
};

export default function TerminalInstance({ sessionId, isActive, onTitleChange }: TerminalInstanceProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalClient = useRef(createTerminalClient());

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#cdd6f4",
        selectionBackground: "rgba(205, 214, 244, 0.3)",
      },
      fontFamily: '"JetBrainsMono Nerd Font", "MesloLGS NF", "MesloLGL Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "CaskaydiaCove Nerd Font", "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    
    // Slight delay to ensure container is properly sized
    setTimeout(() => {
      fitAddon.fit();
    }, 10);

    term.onData((data) => {
      void terminalClient.current.writeInput(sessionId, data);
    });

    term.onResize(({ cols, rows }) => {
      void terminalClient.current.resizeSession(sessionId, rows, cols);
    });

    term.onTitleChange((title) => {
      onTitleChange?.(title);
    });

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      // Refit when tab becomes active, as its size might have changed while hidden
      fitAddonRef.current.fit();
      xtermRef.current?.focus();
    }
  }, [isActive]);

  const handleOutput = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  }, []);

  useTerminalOutput(sessionId, handleOutput);

  return (
    <div 
      ref={terminalRef} 
      style={{ 
        width: "100%", 
        height: "100%", 
        overflow: "hidden", 
        display: isActive ? "block" : "none" 
      }} 
      data-testid="terminal-instance"
    />
  );
}