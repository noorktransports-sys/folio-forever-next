/**
 * Renders schema.org structured data as a JSON-LD <script>. `<` is escaped
 * so text inside the data can never close the script tag.
 */
export default function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
