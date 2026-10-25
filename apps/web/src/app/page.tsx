import { redirect } from "next/navigation";

/** The prototype is the checkout; there is no separate home page. */
export default function Home() {
  redirect("/checkout");
}
