import { useState } from "react";
import styles from "./DidYouKnow.module.css";

/**
 * A "Did you know?" fact. Collapsed it is one plain sentence a reader can
 * take in at a glance; clicking it unfolds the evidence (chart, provenance,
 * footnote). Every fact on the site uses this so they all read the same:
 *
 *   <DidYouKnow more="See how we got there" detail={<>…chart, meta, note…</>}>
 *     Fruit & vegetables prices are up <Figure>1.0%</Figure> this year.
 *   </DidYouKnow>
 *
 * Put the number in <Figure> — it is the only thing in the sentence that
 * gets size and colour. Keep the sentence to one line of plain English:
 * no quarter names, no "YoY", no index values — those belong in `detail`.
 * Closed, the block hugs the sentence; open, it stretches to fit the detail.
 *
 * Pass `open` + `onOpenChange` to drive the fold from outside (so another
 * fact can open this one's chart). Pass `onMore` instead of `detail` when the
 * headline should do something elsewhere rather than unfold here. `extra` is a
 * small control rendered beside the headline, outside the button.
 */
export default function DidYouKnow({ kicker = "Did you know?", more = "See more", less = "Hide the detail", defaultOpen = false, open: openProp, onOpenChange, onMore, extra, detail, children, className = "" }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const controlled = openProp != null;
  const open = controlled ? openProp : openState;
  const setOpen = (next) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const expandable = detail != null || onMore != null;
  const onClick = () => {
    if (onMore) onMore();
    else if (expandable) setOpen(!open);
  };

  return (
    <section className={`${styles.block} ${open ? styles.open : ""} ${className}`}>
      <div className={styles.head}>
        <button type="button" className={styles.headline} onClick={onClick} aria-expanded={onMore ? undefined : open} disabled={!expandable}>
          <span className={styles.kicker}>{kicker}</span>
          <span className={styles.sentence}>{children}</span>
          {expandable && <span className={styles.more}>{open ? `${less} ▴` : `${more} ▾`}</span>}
        </button>
        {extra && <div className={styles.extra}>{extra}</div>}
      </div>
      {open && detail != null && <div className={styles.detail}>{detail}</div>}
    </section>
  );
}

// The headline number inside the sentence: bigger, mono, accent-coloured.
export function Figure({ children }) {
  return <strong className={styles.figure}>{children}</strong>;
}

DidYouKnow.Figure = Figure;

// Small bits for the detail area, so every fact's provenance line looks alike.
export function Meta({ tag, children }) {
  return (
    <p className={styles.meta}>
      {tag && <span className={styles.tag}>{tag}</span>} {children}
    </p>
  );
}
export function Note({ children }) {
  return <p className={styles.note}>{children}</p>;
}
export function Row({ children }) {
  return <div className={styles.row}>{children}</div>;
}
DidYouKnow.Meta = Meta;
DidYouKnow.Note = Note;
DidYouKnow.Row = Row;
