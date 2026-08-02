import Link from "next/link";
import { cmsRegion } from "@/lib/cms/regions";
import type { GlobalContent } from "@/lib/content/schema";

export function SiteHeader({ content }: { content: GlobalContent }) {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label={`${content.siteName}, home`}>
          <span aria-hidden="true">ÓE</span>
          <span
            className="wordmark__name"
            {...cmsRegion({
              id: "global.siteName",
              label: "Site name",
              path: "siteName",
            })}
          >
            {content.siteName}
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          <ul className="nav-list">
            {content.navigation.map((item, index) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  {...cmsRegion({
                    id: `global.navigation.${index}.label`,
                    label: `${item.label} navigation label`,
                    path: `navigation.${index}.label`,
                  })}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
