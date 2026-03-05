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
  const onTitleChangeRef = useRef(onTitleChange);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const waitForFont = (): Promise<boolean> => {
      return new Promise((resolve) => {
        if (document.fonts.check("13px VibetreeNerdMono")) {
          resolve(true);
          return;
        }

        const timeout = setTimeout(() => {
          resolve(false);
        }, 2000);

        document.fonts.load("13px VibetreeNerdMono").then(() => {
          clearTimeout(timeout);
          resolve(true);
        }).catch(() => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    };

    let isMounted = true;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let handleResize: (() => void) | null = null;

    const initTerminal = async () => {
      await waitForFont();
      
      if (!isMounted || !terminalRef.current) return;

      term = new Terminal({
        theme: {
          background: "#1e1e2e",
          foreground: "#cdd6f4",
          cursor: "#cdd6f4",
          selectionBackground: "rgba(205, 214, 244, 0.3)",
          black: "#45475a",
          red: "#f38ba8",
          green: "#a6e3a1",
          yellow: "#f9e2af",
          blue: "#89b4fa",
          magenta: "#f5c2e7",
          cyan: "#94e2d5",
          white: "#bac2de",
          brightBlack: "#585b70",
          brightRed: "#f38ba8",
          brightGreen: "#a6e3a1",
          brightYellow: "#f9e2af",
          brightBlue: "#89b4fa",
          brightMagenta: "#f5c2e7",
          brightCyan: "#94e2d5",
          brightWhite: "#a6adc8",
        },
        fontFamily: '"VibetreeNerdMono", "JetBrainsMono Nerd Font", "MesloLGS NF", "MesloLGL Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "CaskaydiaCove Nerd Font", "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 10000,
        convertEol: true,
        allowTransparency: true,
      });
      
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      
      term.open(terminalRef.current);
      
      setTimeout(() => {
        fitAddon?.fit();
      }, 10);

      term.onData((data) => {
        void terminalClient.current.writeInput(sessionId, data);
      });

      term.onResize(({ cols, rows }) => {
        void terminalClient.current.resizeSession(sessionId, rows, cols);
      });

      term.onTitleChange((title) => {
        onTitleChangeRef.current?.(title);
      });

      handleResize = () => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      };

      window.addEventListener("resize", handleResize);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    };

    initTerminal();

    return () => {
      isMounted = false;
      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }
      if (term) {
        term.dispose();
      }
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (isActive && fitAddonRef.current) {
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
