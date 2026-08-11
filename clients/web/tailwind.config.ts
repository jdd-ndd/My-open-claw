import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Work Sans"', 'system-ui', 'sans-serif'],
        display: ['"Sora"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        teal: {
          DEFAULT: 'hsl(var(--teal))',
          foreground: 'hsl(var(--teal-foreground))',
        },
        lavender: {
          DEFAULT: 'hsl(var(--lavender))',
          foreground: 'hsl(var(--lavender-foreground))',
        },
        coral: {
          DEFAULT: 'hsl(var(--coral))',
          foreground: 'hsl(var(--coral-foreground))',
        },
        mint: {
          DEFAULT: 'hsl(var(--mint))',
          foreground: 'hsl(var(--mint-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        soft: '0 2px 8px -2px rgb(0 0 0 / 0.05), 0 8px 24px -8px rgb(0 0 0 / 0.08)',
        glow: '0 0 20px -2px hsl(var(--primary) / 0.25)',
        'glow-accent': '0 0 20px -2px hsl(var(--accent) / 0.3)',
        'lg-soft': '0 4px 12px -2px rgb(0 0 0 / 0.06), 0 16px 40px -12px rgb(0 0 0 / 0.1)',
      },
      backgroundImage: {
        'aurora-light':
          'radial-gradient(ellipse 80% 60% at 20% 20%, hsl(var(--primary) / 0.08), transparent), radial-gradient(ellipse 60% 50% at 80% 80%, hsl(var(--teal) / 0.06), transparent), radial-gradient(ellipse 50% 40% at 50% 50%, hsl(var(--lavender) / 0.05), transparent)',
        'aurora-dark':
          'radial-gradient(ellipse 80% 60% at 20% 20%, hsl(var(--primary) / 0.15), transparent), radial-gradient(ellipse 60% 50% at 80% 80%, hsl(var(--teal) / 0.1), transparent), radial-gradient(ellipse 50% 40% at 50% 50%, hsl(var(--lavender) / 0.08), transparent)',
        'gradient-primary':
          'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--teal)) 100%)',
        'gradient-accent':
          'linear-gradient(135deg, hsl(var(--accent)) 0%, hsl(var(--coral)) 100%)',
        'gradient-warm':
          'linear-gradient(135deg, hsl(var(--accent) / 0.9) 0%, hsl(var(--coral) / 0.9) 100%)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'float': 'float 4s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
