import { cmsRegion } from "@/lib/cms/regions";
import type { GlobalContent } from "@/lib/content/schema";

export function SiteFooter({ content }: { content: GlobalContent }) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p {...cmsRegion({ id: "global.footer", label: "Footer text", path: "footer" })}>
          {content.footer}
        </p>
        <ul aria-label="Contact and social links">
          {content.socialLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <p className="site-footer__meta">© {new Date().getFullYear()} Ólavur Ellefsen</p>
      </div>
    </footer>
  );
}
