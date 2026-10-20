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
        // Pinned in real px, matching the Option B type scale's caption (12)
        // and label (13) steps exactly — independent of the html root
        // font-size, and the 12px one can never drop below the a11y floor.
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "Segoe UI", "Tahoma", "Arial", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        // Our own teal, not ERP's blue — primary (#077A84) into the darker sidebar teal (#2d6a75).
        'hero-gradient': 'linear-gradient(135deg, hsl(185 90% 27%), hsl(189 44% 24%))',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        heading: "hsl(var(--heading))",
        label: "hsl(var(--label))",
        "brand-teal": "hsl(var(--brand-teal))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          soft: "hsl(var(--primary-soft))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          bg: "hsl(var(--destructive-bg))",
          border: "hsl(var(--destructive-border))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        disabled: {
          bg: "hsl(var(--disabled-bg))",
        },
        skeleton: "hsl(var(--skeleton))",
        "table-header": "hsl(var(--table-header-bg))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          bg: "hsl(var(--success-bg))",
          border: "hsl(var(--success-border))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          bg: "hsl(var(--warning-bg))",
          border: "hsl(var(--warning-border))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          bg: "hsl(var(--info-bg))",
          border: "hsl(var(--info-border))",
        },
        neutral: {
          DEFAULT: "hsl(var(--neutral))",
          foreground: "hsl(var(--neutral-foreground))",
          bg: "hsl(var(--neutral-bg))",
          border: "hsl(var(--neutral-border))",
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
