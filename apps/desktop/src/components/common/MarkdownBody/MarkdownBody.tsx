import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TextLink } from "../TextLink/TextLink";
import "./MarkdownBody.css";

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
    return <span className="markdown-body__link-plain">{children}</span>;
  },
};

export interface MarkdownBodyProps {
  source: string;
}

export function MarkdownBody({ source }: MarkdownBodyProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
