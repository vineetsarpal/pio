import { NextResponse } from "next/server";
import { authenticateOperator } from "./operator-auth";

export function operatorOk(request: Request): boolean {
  try {
    return authenticateOperator(request);
  } catch {
    return false;
  }
}

export function unauthorized() {
  return NextResponse.json(
    { accepted: false, reasonCode: "unauthorized", message: "A valid operator key is required." },
    { status: 401 }
  );
}
