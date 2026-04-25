import DualCropToolPage from "./DualCrop";
import { Toaster } from "@/components/ui/sonner";

export default function App() {
  return (
    <>
      <DualCropToolPage />
      <Toaster richColors position="bottom-right" />
    </>
  );
}