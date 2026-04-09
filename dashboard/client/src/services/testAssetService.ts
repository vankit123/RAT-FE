import { BACKEND_ENDPOINTS } from "./endpoints";
import { postBackendFormData } from "./httpService";

export type TestAssetUploadResponse = {
  id: number;
  projectId: number;
  originalName: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
};

export async function uploadTestAsset(
  projectId: number,
  file: File,
): Promise<TestAssetUploadResponse> {
  const formData = new FormData();
  formData.append("projectId", String(projectId));
  formData.append("file", file);
  return postBackendFormData<TestAssetUploadResponse>(
    BACKEND_ENDPOINTS.testAssets.upload,
    formData,
  );
}
