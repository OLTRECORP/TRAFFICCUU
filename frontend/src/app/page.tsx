import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard"); // el middleware envía a /login si no hay sesión
}
