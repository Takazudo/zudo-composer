import type { JSX } from "preact";
import { ArrowRightIcon, ComposerIcon } from "../components/icons";
import { APP_ROUTES } from "./shell";

export function Home(): JSX.Element {
  const workspaceRoutes = APP_ROUTES.filter((route) => route.href !== "/");
  return (
    <main class="home-dashboard landing" aria-labelledby="home-title">
      <section class="home-dashboard__hero">
        <div>
          <p class="eyebrow">Standalone authoring workspace</p>
          <h1 id="home-title">Build structures, not documents.</h1>
          <p class="home-dashboard__lede">Composer, Content, Mapping, Sitemapper, and Media are focused tools for shaping a reusable content system in your local browser.</p>
          <a class="primary-link home-dashboard__primary" href="/composer">
            <ComposerIcon size="sm" />
            <span>Open Composer</span>
            <ArrowRightIcon size="sm" />
          </a>
        </div>
        <aside class="home-dashboard__local-note" aria-labelledby="home-local-title">
          <p class="eyebrow">Local-first by default</p>
          <h2 id="home-local-title">A clear starting point</h2>
          <p>Choose a workspace below. Your authoring session stays in this browser, with no account or delivery setup required.</p>
        </aside>
      </section>

      <section class="home-dashboard__workspaces" aria-labelledby="home-workspaces-title">
        <div class="home-dashboard__section-heading">
          <div>
            <p class="eyebrow">Workspaces</p>
            <h2 id="home-workspaces-title">Choose a tool</h2>
          </div>
          <p>Each workspace has one job and keeps its current state visible.</p>
        </div>
        <div class="home-route-grid">
          {workspaceRoutes.map((route) => {
            const RouteIcon = route.icon;
            const descriptionId = `home-route-${route.href.slice(1)}-description`;
            return (
              <a
                key={route.href}
                class="home-route-card"
                href={route.href}
                aria-label={`${route.label} workspace`}
                aria-describedby={descriptionId}
              >
                <div class="home-route-card__heading">
                  <RouteIcon size="md" />
                  <h3>{route.label}</h3>
                </div>
                <p id={descriptionId}>{route.description}</p>
                <span class="home-route-card__action">Open workspace <ArrowRightIcon size="sm" /></span>
              </a>
            );
          })}
        </div>
      </section>
    </main>
  );
}
