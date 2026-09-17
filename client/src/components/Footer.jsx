import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerNav}>
        <a href="#/" className={styles.wordmark}>Cost of Living AU</a>
        <p className={styles.links}>
          Categories · Cheapest today · Shrinkflation · Specials checker<br />
          My basket · Methodology · Data download · Contact
        </p>
      </div>
      <hr className={styles.rule} />
      <p className={styles.note}>Prices are observed, not advertised. Source and capture time shown on every price.</p>
    </footer>
  );
}
