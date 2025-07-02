export const LandingTech = () => {
  return (
    <div className="tech-section">
      <div className="tech-section-row">
        <div className="tech-header">
          <h2 className="tech-section-heading">Runs Anywhere</h2>
          <p className="tech-section-text">
            Deploy RivetKit anywhere - from serverless platforms to your own
            infrastructure with RivetKit's flexible runtime options.
          </p>
          <p className="tech-section-text">
            Don't see the runtime you want?{" "}
            <a href="/drivers/building-drivers">Add your own</a>.
          </p>
        </div>

        <div className="tech-content">
          <div className="tech-category">
            <h3 className="tech-category-title">All-In-One</h3>
            <div className="tech-buttons-grid">
              <a href="/drivers/rivet" className="tech-button">
                <img
                  src="/images/platforms/rivet-white.svg"
                  alt="Rivet"
                  className="tech-icon"
                  noZoom
                />
                Rivet
              </a>
              <a href="/drivers/cloudflare-workers" className="tech-button">
                <img
                  src="/images/platforms/cloudflare-workers.svg"
                  alt="Cloudflare"
                  className="tech-icon"
                  noZoom
                />
                Cloudflare
              </a>
            </div>
          </div>

          <div className="tech-category">
            <h3 className="tech-category-title">Compute</h3>
            <div className="tech-buttons-grid">
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/897"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/platforms/vercel.svg"
                  alt="Vercel"
                  className="tech-icon"
                  noZoom
                />
                Vercel
                <span className="coming-soon">On The Roadmap</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/898"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/platforms/aws-lambda.svg"
                  alt="AWS Lambda"
                  className="tech-icon"
                  noZoom
                />
                AWS Lambda
                <span className="coming-soon">On The Roadmap</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/905"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/platforms/supabase.svg"
                  alt="Supabase"
                  className="tech-icon"
                  noZoom
                />
                Supabase
                <span className="help-wanted">Help Wanted</span>
              </a>
              <a href="/actors/quickstart-backend" className="tech-button">
                <img
                  src="/images/platforms/bun.svg"
                  alt="Bun"
                  className="tech-icon"
                  noZoom
                />
                Bun
              </a>
              <a href="/actors/quickstart-backend" className="tech-button">
                <img
                  src="/images/platforms/nodejs.svg"
                  alt="Node.js"
                  className="tech-icon"
                  noZoom
                />
                Node.js
              </a>
            </div>
          </div>

          <div className="tech-category">
            <h3 className="tech-category-title">Storage</h3>
            <div className="tech-buttons-grid">
              <a href="/drivers/redis" className="tech-button">
                <img
                  src="/images/platforms/redis.svg"
                  alt="Redis"
                  className="tech-icon"
                  noZoom
                />
                Redis
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/899"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/platforms/postgres.svg"
                  alt="Postgres"
                  className="tech-icon"
                  noZoom
                />
                Postgres
                <span className="help-wanted">Help Wanted</span>
              </a>
              <a href="/drivers/file-system" className="tech-button">
                <img
                  src="/images/platforms/file-system.svg"
                  alt="File System"
                  className="tech-icon"
                  noZoom
                />
                File System
              </a>
              <a href="/drivers/memory" className="tech-button">
                <img
                  src="/images/platforms/memory.svg"
                  alt="Memory"
                  className="tech-icon"
                  noZoom
                />
                Memory
              </a>
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: "20px" }} />

      <div className="tech-section-row">
        <div className="tech-header">
          <h2 className="tech-section-heading">Works With Your Tools</h2>
          <p className="tech-section-text">
            Seamlessly integrate RivetKit with your favorite frameworks,
            languages, and tools.
          </p>
          <p className="tech-section-text">
            Don't see what you need?{" "}
            <a
              href="https://github.com/rivet-gg/rivetkit/issues/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Request an integration
            </a>
            .
          </p>
        </div>

        <div className="tech-content">
          <div className="tech-category">
            <h3 className="tech-category-title">Frameworks</h3>
            <div className="tech-buttons-grid">
              <a href="/clients/react" className="tech-button">
                <img
                  src="/images/clients/react.svg"
                  alt="React"
                  className="tech-icon"
                  noZoom
                />
                React
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/904"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/clients/nextjs.svg"
                  alt="Next.js"
                  className="tech-icon"
                  noZoom
                />
                Next.js
                <span className="help-wanted">Help Wanted</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/903"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/clients/vue.svg"
                  alt="Vue"
                  className="tech-icon"
                  noZoom
                />
                Vue
                <span className="help-wanted">Help Wanted</span>
              </a>
            </div>
          </div>

          <div className="tech-category">
            <h3 className="tech-category-title">Clients</h3>
            <div className="tech-buttons-grid">
              <a href="/clients/javascript" className="tech-button">
                <img
                  src="/images/clients/javascript.svg"
                  alt="JavaScript"
                  className="tech-icon"
                  noZoom
                />
                JavaScript
              </a>
              <a href="/clients/javascript" className="tech-button">
                <img
                  src="/images/clients/typescript.svg"
                  alt="TypeScript"
                  className="tech-icon"
                  noZoom
                />
                TypeScript
              </a>
              <a href="/clients/rust" className="tech-button">
                <img
                  src="/images/clients/rust.svg"
                  alt="Rust"
                  className="tech-icon"
                  noZoom
                />
                Rust
              </a>
            </div>
          </div>

          <div className="tech-category">
            <h3 className="tech-category-title">Integrations</h3>
            <div className="tech-buttons-grid">
              <a href="/integrations/hono" className="tech-button">
                <img
                  src="/images/integrations/hono.svg"
                  alt="Hono"
                  className="tech-icon"
                  noZoom
                />
                Hono
              </a>
              <a href="/integrations/express" className="tech-button">
                <img
                  src="/images/integrations/express.svg"
                  alt="Express"
                  className="tech-icon"
                  noZoom
                />
                Express
              </a>
              <a href="/integrations/elysia" className="tech-button">
                <img
                  src="/images/integrations/elysia.svg"
                  alt="Elysia"
                  className="tech-icon"
                  noZoom
                />
                Elysia
              </a>
              <a href="/general/testing" className="tech-button">
                <img
                  src="/images/integrations/vitest.svg"
                  alt="Vitest"
                  className="tech-icon"
                  noZoom
                />
                Vitest
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/906"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/integrations/better-auth.svg"
                  alt="Better Auth"
                  className="tech-icon"
                  noZoom
                />
                Better Auth
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/907"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/platforms/vercel.svg"
                  alt="AI SDK"
                  className="tech-icon"
                  noZoom
                />
                AI SDK
                <span className="coming-soon">On The Roadmap</span>
              </a>
            </div>
          </div>

          <div className="tech-category">
            <h3 className="tech-category-title">Local-First Sync</h3>
            <div className="tech-buttons-grid">
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/908"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/integrations/livestore.svg"
                  alt="LiveStore"
                  className="tech-icon"
                  noZoom
                />
                LiveStore
                <span className="coming-soon">Available In July</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/909"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/integrations/zerosync.svg"
                  alt="ZeroSync"
                  className="tech-icon"
                  noZoom
                />
                ZeroSync
                <span className="help-wanted">Help Wanted</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/910"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/integrations/tinybase.svg"
                  alt="TinyBase"
                  className="tech-icon"
                  noZoom
                />
                TinyBase
                <span className="help-wanted">Help Wanted</span>
              </a>
              <a
                href="https://github.com/rivet-gg/rivetkit/issues/911"
                target="_blank"
                rel="noopener noreferrer"
                className="tech-button"
              >
                <img
                  src="/images/integrations/yjs.svg"
                  alt="Yjs"
                  className="tech-icon"
                  noZoom
                />
                Yjs
                <span className="help-wanted">Help Wanted</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
