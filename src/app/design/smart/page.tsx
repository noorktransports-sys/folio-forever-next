/**
 * /design — thin re-export of the actual designer component, which
 * lives in the catch-all route at /design/[[...step]]/page.tsx.
 *
 * Why both files exist:
 *   The catch-all matches /design AND any sub-path (/design/product,
 *   /design/build, etc.). When Next.js sees BOTH a static page.tsx
 *   and an optional catch-all at the same level, some versions throw
 *   "two routes resolve to the same path" at build time. Giving the
 *   static route a default export that just re-exports the catch-all
 *   keeps Next.js happy AND ensures /design hits the same component
 *   regardless of which file the router picks.
 */
import DesignerPage from './[[...step]]/page';
export default DesignerPage;
