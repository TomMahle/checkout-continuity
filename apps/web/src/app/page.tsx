import { redirect } from "next/navigation";

export const instant = false;
/** The prototype is the checkout; there is no separate home page. */
export default function Home() {
  redirect("/checkout");
}
