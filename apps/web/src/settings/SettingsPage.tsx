/**
 * Settings (settings.dc.html): a page of its own, one column of at most 720px, in place of the
 * week at every width.
 *
 * Reached from the Menu. "‹ Back to the week" and Esc go back, and the week puts focus on the
 * day that was left: the page is drawn by the week's screen, which keeps its week and its day
 * underneath (decided on 2026-11-23).
 *
 * Each section saves where the server draws its line. The account is read only: the address
 * is the one signed up with, and the zone was set then too. The theme is not on the server and
 * applies as it is tapped. The usable day, the days off and the block save together, the
 * password is its own form, and signing out is an action of its own.
 */
import { useId } from "react";

import type { Me } from "../api/types";
import { SignOutButton } from "../ui/SignOutButton";
import { PasswordForm } from "./PasswordForm";
import { PlanningForm } from "./PlanningForm";
import styles from "./Settings.module.css";
import { ThemeChoice } from "./ThemeChoice";

interface Props {
  me: Me;
  onBack: () => void;
  /** The usable day, the days off or the block were saved; the sentence says how. */
  onSaved: (text: string) => void;
  /** Resolves once the server has ended the session; rejects when it did not. */
  onSignOut: () => Promise<void>;
}

export function SettingsPage({ me, onBack, onSaved, onSignOut }: Props): React.ReactNode {
  const account = useId();
  const out = useId();

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} aria-keyshortcuts="Escape" onClick={onBack}>
          ‹ Back to the week
        </button>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <section aria-labelledby={account} className={styles.section}>
        <h2 id={account} className={styles.heading}>
          Account
        </h2>
        <dl className={styles.facts}>
          <div>
            <dt>Address</dt>
            <dd>{me.email}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{me.timezone}</dd>
            <dd className={styles.note}>
              Every task falls on a day by this zone: a task at 23:30 here is on that day, wherever
              you are. It was set when you signed up.
            </dd>
          </div>
        </dl>
      </section>

      <ThemeChoice />

      <PlanningForm me={me} onSaved={onSaved} />

      <PasswordForm email={me.email} timezone={me.timezone} />

      <section aria-labelledby={out} className={styles.section}>
        <h2 id={out} className={styles.heading}>
          Sign out
        </h2>
        <p className={styles.lede}>
          Only this browser. Nothing is deleted, and your other devices stay signed in.
        </p>
        <SignOutButton className={styles.button} onSignOut={onSignOut} />
      </section>
    </div>
  );
}
