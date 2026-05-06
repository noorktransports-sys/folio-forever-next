/**
 * Catch-all route for /design/* — re-exports the main DesignerPage so
 * any sub-path (/design/product, /design/build, /design/cover, etc.)
 * lands on the same component. The component itself reads
 * params.step via useParams to decide which section to render.
 *
 * The double-bracket [[...step]] syntax means this also matches the
 * empty step (just /design); Next.js prefers the more-specific
 * /design/page.tsx for that exact path, so /design hits the parent
 * file and any sub-path hits this one. Both share the same component.
 */
import DesignerPage from '../page';
export default DesignerPage;
