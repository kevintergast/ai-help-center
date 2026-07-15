import { cn } from "@/lib/ui/cn";

/**
 * Volles Logo MIT Claim (public/brand/logo-with-claim-*.svg, 496×131) — ersetzt
 * im Header der Operator-Instanz das frühere Emblem+Schriftzug-Paar
 * (User-Vorgabe 2026-07-15). Light-/Dark-Variante folgt dem Theme über die
 * CSS-Klassen theme-light-only/theme-dark-only (globals.css — dieselbe Logik
 * wie die Token-Blöcke: System-Präferenz, außer data-theme erzwingt).
 * Nur die sichtbare Variante trägt den Alt-Text (kein Doppel-Announcement).
 */
export function LogoWithClaim({ className, alt }: { className?: string; alt: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-with-claim-lightmode.svg"
        alt={alt}
        className={cn("theme-light-only", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-with-claim-darkmode.svg"
        alt=""
        aria-hidden
        className={cn("theme-dark-only", className)}
      />
    </>
  );
}

/**
 * HallOfHelp-Bildmarke (Original-SVG des Nutzers). Inline, damit der Verlauf
 * ohne externen Request rendert. Genutzt im Header der Plattform-/Operator-
 * Instanz; identische Grafik als Favicon unter src/app/icon.svg.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      role="img"
      aria-hidden
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(51.2 51.2) scale(0.8)">
        <path
          d="M180.774 480.372C180.774 492.317 171.091 502 159.146 502H116.4C106.417 502 97.7306 495.167 95.3799 485.465L44.4399 275.205C41.803 264.321 47.9105 253.225 58.5164 249.63L97.9373 236.267C109.676 232.287 122.351 238.968 125.703 250.901L148.37 331.596C151.231 341.782 161.041 348.403 171.557 347.246L367.525 325.687C378.489 324.481 386.788 315.218 386.788 304.189V58.8249C386.788 46.8801 396.471 37.1969 408.416 37.1969H446.548C458.493 37.1969 468.176 46.8801 468.176 58.8249V480.372C468.176 492.317 458.493 502 446.548 502H408.416C396.471 502 386.788 492.317 386.788 480.372V443.248C386.788 430.522 375.854 420.547 363.182 421.711L200.424 436.662C189.292 437.684 180.774 447.021 180.774 458.199V480.372Z"
          fill="url(#hoh-mark)"
        />
        <path
          d="M313.893 251.22C313.893 277.139 295.035 299.205 269.432 303.244C247.805 306.656 226.323 296.332 215.476 277.313L208.093 264.368C202.862 255.198 195.737 247.248 187.191 241.05L159.537 220.993C112.354 186.773 98.0959 122.287 125.703 70.9541C152.717 20.7232 212.865 -2.67446 266.442 16.8805C325.542 38.4514 356.252 103.589 335.287 162.907L317.947 211.967C315.264 219.56 313.893 227.554 313.893 235.606V251.22Z"
          fill="url(#hoh-mark)"
        />
      </g>
      <defs>
        <linearGradient
          id="hoh-mark"
          x1="45.1799"
          y1="262.741"
          x2="466.926"
          y2="265.444"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4991FC" />
          <stop offset="0.456731" stopColor="#4973FC" />
          <stop offset="1" stopColor="#4952FC" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Monochromes Emblem in `currentColor` — folgt der Textfarbe (z. B. `text-ink`
 * → schwarz im Light-, weiß im Dark-Mode). Für die Legal-Zeile am Seitenfuß.
 */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      fill="currentColor"
      role="img"
      aria-hidden
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M47.4832 113.252C47.4832 115.874 45.3576 118 42.7356 118H33.3523C31.1608 118 29.2541 116.5 28.7381 114.37L17.5562 68.2158C16.9773 65.8266 18.318 63.3908 20.6461 62.6016L29.2995 59.6683C31.8763 58.7948 34.6586 60.2612 35.3944 62.8807L40.3701 80.5943C40.9982 82.8302 43.1515 84.2835 45.46 84.0295L88.4773 79.2971C90.8839 79.0324 92.7058 76.9991 92.7058 74.578V20.7177C92.7058 18.0956 94.8314 15.9701 97.4534 15.9701H105.824C108.446 15.9701 110.571 18.0956 110.571 20.7177V113.252C110.571 115.874 108.446 118 105.824 118H97.4534C94.8314 118 92.7058 115.874 92.7058 113.252V105.103C92.7058 102.31 90.3057 100.12 87.5239 100.376L51.7965 103.657C49.3531 103.882 47.4832 105.931 47.4832 108.385V113.252Z" />
      <path d="M76.7043 62.9508C76.7043 68.6403 72.5648 73.4841 66.9448 74.3707C62.1973 75.1196 57.4817 72.8533 55.1006 68.6785L53.4799 65.8369C52.3318 63.8239 50.7676 62.0789 48.8917 60.7183L42.8213 56.3156C32.4642 48.8038 29.3343 34.6484 35.3944 23.3802C41.3244 12.3539 54.5275 7.2178 66.2884 11.5104C79.2616 16.2454 86.0027 30.544 81.4006 43.5649L77.5943 54.3343C77.0053 56.0009 76.7043 57.7557 76.7043 59.5233V62.9508Z" />
    </svg>
  );
}
