"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { SiteContent } from "@/server/settings/site-content";
import type { MediaChoice } from "../media-field";
import { ListSectionForm } from "./list-section-form";
import { AboutForm, ContactForm, FeaturedForm, FooterForm, HeroForm, LegalForm, SeoForm } from "./object-forms";
import { EDITOR_TABS, LIST_SPECS, type EditorTab } from "./site-model";

interface SiteEditorProps {
  content: SiteContent;
  heroImage: MediaChoice | null;
  portrait: MediaChoice | null;
  origin: string;
  canUpload: boolean;
  icons: readonly string[];
  seoPages: readonly string[];
  initialTab: EditorTab;
}

/**
 * Every section of the website content, grouped by page. All tab panels stay
 * mounted (only hidden), so unsaved edits survive switching tabs; each section
 * saves on its own.
 */
export function SiteEditor({ content, heroImage, portrait, origin, canUpload, icons, seoPages, initialTab }: SiteEditorProps) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const tabRefs = useRef<Partial<Record<EditorTab, HTMLButtonElement | null>>>({});

  function select(next: EditorTab, focus = false) {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
    // Deep link to the open tab without a navigation.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = EDITOR_TABS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    select(EDITOR_TABS[target]!.id, true);
  }

  return (
    <>
      <div role="tablist" aria-label="Website pages" className="tabs-list no-scrollbar mb-6 max-w-full justify-start overflow-x-auto">
        {EDITOR_TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            type="button"
            role="tab"
            id={`site-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`site-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className="tabs-trigger"
            onClick={() => select(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Panel id="home" tab={tab}>
        <HeroForm initial={content.hero} image={heroImage} origin={origin} canUpload={canUpload} />
        <ListSectionForm spec={LIST_SPECS.stats} initial={content.stats} origin={origin} />
        <ListSectionForm spec={LIST_SPECS.valueProps} initial={content.valueProps} origin={origin} icons={icons} />
        <FeaturedForm initial={content.featured} origin={origin} />
      </Panel>

      <Panel id="about" tab={tab}>
        <AboutForm initial={content.about} portrait={portrait} origin={origin} canUpload={canUpload} />
        <ListSectionForm spec={LIST_SPECS.languages} initial={content.languages} origin={origin} />
        <ListSectionForm spec={LIST_SPECS.skills} initial={content.skills} origin={origin} />
        <ListSectionForm spec={LIST_SPECS.qualifications} initial={content.qualifications} origin={origin} />
        <ListSectionForm spec={LIST_SPECS.milestones} initial={content.milestones} origin={origin} />
      </Panel>

      <Panel id="contact" tab={tab}>
        <ListSectionForm spec={LIST_SPECS.faq} initial={content.faq} origin={origin} />
        <ContactForm initial={content.contact} origin={origin} />
      </Panel>

      <Panel id="seo" tab={tab}>
        <SeoForm initial={content.seo} pages={seoPages} origin={origin} />
      </Panel>

      <Panel id="footer" tab={tab}>
        <FooterForm initial={content.footer} origin={origin} />
        <LegalForm initial={content.legal} origin={origin} />
      </Panel>
    </>
  );
}

function Panel({ id, tab, children }: { id: EditorTab; tab: EditorTab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`site-panel-${id}`} aria-labelledby={`site-tab-${id}`} hidden={tab !== id} className="flex max-w-4xl flex-col gap-6">
      {children}
    </div>
  );
}
