"use client";

import { useState } from "react";
import { monogram } from "@/lib/api/format";

/**
 * Agent avatar: renders the logo image when available, falling back to a
 * two-letter monogram if there's no logo or the image fails to load.
 */
export default function Avatar({
  name,
  logo,
  size = "md",
}: {
  name: string;
  logo?: string | null;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const cls = `avatar${size === "lg" ? " lg" : ""}`;

  if (logo && !failed) {
    return (
      <div className={cls}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={name}
          className="avatar-img"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return <div className={cls}>{monogram(name)}</div>;
}
