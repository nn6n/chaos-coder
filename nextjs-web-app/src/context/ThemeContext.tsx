"use client";

import { createContext, useContext, useEffect } from "react";

type Theme = "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme: Theme = "dark";

  useEffect(() => {
    // Always set dark theme
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  // Keep toggleTheme function but make it do nothing since we're enforcing dark mode
  const toggleTheme = () => {
    // Do nothing - we're enforcing dark mode
    return;
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
