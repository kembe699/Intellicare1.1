import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1rem',
        md: '1.5rem',
        lg: '2rem',
        xl: '2rem',
        '2xl': '2rem',
      },
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        // Mobile-first breakpoints
        xs: '320px',
        // Custom breakpoints for IntelliCare
        'mobile': '320px',
        'tablet': '768px',
        'desktop': '1024px',
        'large': '1440px',
      },
      spacing: {
        'touch': '48px', // Minimum touch target
        'touch-spacing': '8px', // Space between touch targets
      },
      fontSize: {
        'mobile-xs': '12px',
        'mobile-sm': '14px',
        'mobile-base': '16px',
        'mobile-lg': '18px',
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Tahoma", "Arial", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        // Our own teal, not ERP's blue — primary (#1A7A75) into the darker sidebar teal (#2d6a75).
        'hero-gradient': 'linear-gradient(135deg, hsl(177 65% 29%), hsl(189 44% 24%))',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        clinic: {
          teal: "hsl(var(--clinic-teal))",
          "teal-light": "hsl(var(--clinic-teal-light))",
          amber: "hsl(var(--clinic-amber))",
          red: "hsl(var(--clinic-red))",
          green: "hsl(var(--clinic-green))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",            /* 8px */
        md: "calc(var(--radius) - 2px)", /* 6px */
        sm: "calc(var(--radius) - 4px)", /* 4px */
        xl: "calc(var(--radius) + 4px)", /* 12px */
        "2xl": "calc(var(--radius) + 8px)", /* 16px */
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
