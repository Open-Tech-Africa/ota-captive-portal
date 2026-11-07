import { NextResponse } from "next/server"
import { appDb } from "@/lib/db/app"
import { refundRequestSchema } from "@/lib/schemas/admin"
import { refundTransaction } from "@/lib/paystack/client"

export async function POST(request: Request) {
  const body = refundRequestSchema.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const transaction = await appDb.paystackTransaction.findUnique({
    where: { id: body.data.transactionId },
  })
  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }
  if (transaction.status !== "SUCCESS") {
    return NextResponse.json(
      { error: `Only a successful payment can be refunded (this one is ${transaction.status})` },
      { status: 400 },
    )
  }

  try {
    await refundTransaction(transaction.reference, "Refunded via staff admin")
    await appDb.paystackTransaction.update({
      where: { id: transaction.id },
      data: { status: "REFUNDED" },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[admin/paystack/refund] failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refund failed" },
      { status: 502 },
    )
  }
}
