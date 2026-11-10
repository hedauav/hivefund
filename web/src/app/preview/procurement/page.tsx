import { notFound } from "next/navigation";
import { PreviewStory } from "./story";

// Design preview for procurement bounties, rendered from a typed FIXTURE (not a real run).
// Available in `next dev`, or in a build only when NEXT_PUBLIC_SHOW_PREVIEW=1.
export default function ProcurementPreview() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SHOW_PREVIEW !== "1") notFound();
  return <PreviewStory />;
}
