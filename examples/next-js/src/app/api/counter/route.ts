import { counter } from "@/lib/counter";

export const runtime = "nodejs"; // optional, fine for Node runtime

console.log("=== LOAD ROUTE ===");

export async function GET() {
	return Response.json({ value: counter.value });
}

export async function POST(req: Request) {
	const body = await req.json().catch(() => ({}));
	const by = Number(body?.by ?? 1);
	counter.value += Number.isFinite(by) ? by : 1;
	return Response.json({ value: counter.value });
}
