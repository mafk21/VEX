import ScanStatus from "@/components/scan-status";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ScanPage({ params }: Props) {
  const { id } = await params;
  return <ScanStatus scanId={id} />;
}
