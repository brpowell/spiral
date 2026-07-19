import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TextLink } from "../common/TextLink/TextLink";
import "./PackReadmeMarkdown.css";

function isExternalHref(href: string | undefined): boolean {
  if (!href) return false;
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:");
}

const components: Components = {
  a({ href, children }) {
    if (isExternalHref(href)) {
      return (
        <TextLink
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            if (href) void openUrl(href);
          }}
        >
          {children}
        </TextLink>
      );
    }
    return <span className="pack-readme__link-plain">{children}</span>;
  },
};

interface PackReadmeMarkdownProps {
  source: string;
}

export function PackReadmeMarkdown({ source }: PackReadmeMarkdownProps) {
  return (
    <div className="pack-readme">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
