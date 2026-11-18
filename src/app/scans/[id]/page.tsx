import ScanView from "@/components/scan-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ScanPage({ params }: Props) {
  const { id } = await params;
  return <ScanView scanId={id} />;
}
