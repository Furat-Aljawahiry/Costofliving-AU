import styles from "./NotWired.module.css";

/**
 * The honest placeholder. Anywhere the design calls for a number we do not
 * yet measure renders one of these instead of a made-up figure, so nobody
 * mistakes a mock for a result. `needs` says what data would light it up.
 */
export default function NotWired({ label = "Not wired yet", needs, minHeight, inline = false, className = "" }) {
  if (inline) {
    return <span className={`${styles.inline} ${className}`} title={needs}>{label}</span>;
  }
  return (
    <div className={`${styles.block} ${className}`} style={minHeight ? { minHeight } : undefined}>
      <span className={styles.tag}>NOT WIRED YET</span>
      <p className={styles.label}>{label}</p>
      {needs && <p className={styles.needs}>Needs: {needs}</p>}
    </div>
  );
}
