// IPTAS logo: a clock whose hands form a check mark (time tracked → pay approved)
export default function Logo({ size = 40, className = "" }) {
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="IPTAS logo">
      <rect width="64" height="64" rx="16" fill="#C8213A" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#fff" strokeWidth="4.5" />
      <g stroke="#fff" strokeWidth="3" strokeLinecap="round">
        <line x1="32" y1="16.5" x2="32" y2="19.5" /><line x1="47.5" y1="32" x2="44.5" y2="32" />
        <line x1="32" y1="47.5" x2="32" y2="44.5" /><line x1="16.5" y1="32" x2="19.5" y2="32" />
      </g>
      <path d="M23.5 32.5 L29.5 38.5 L41 25" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
