import { Suspense } from "react";
import FollowingFeed from "@/components/FollowingFeed";

export default function Home() {
  return (
    <Suspense>
      <FollowingFeed />
    </Suspense>
  );
}
