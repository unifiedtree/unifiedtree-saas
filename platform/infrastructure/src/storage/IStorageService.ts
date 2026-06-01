export interface UploadedFile {
  id: string
  originalName: string
  storedName: string
  url: string
  size: number
  mimeType: string
  tenantId: string
  uploadedBy: string
  folder: string
  createdAt: string
}

export interface IStorageService {
  /**
   * Upload a File object (browser File API) to a folder under a tenant's namespace.
   */
  upload(file: File, folder: string, tenantId: string): Promise<UploadedFile>

  /**
   * Upload from an ArrayBuffer — useful for server-side / Node.js contexts.
   */
  uploadFromBuffer(
    buffer: ArrayBuffer,
    filename: string,
    mimeType: string,
    folder: string,
    tenantId: string
  ): Promise<UploadedFile>

  /**
   * Get the public URL for a stored file.
   */
  getUrl(storedName: string, tenantId: string): string

  /**
   * Get a pre-signed URL that expires after `expiresInSeconds`.
   */
  getSignedUrl(
    storedName: string,
    tenantId: string,
    expiresInSeconds?: number
  ): Promise<string>

  /**
   * Delete a file from storage.
   */
  delete(storedName: string, tenantId: string): Promise<void>

  /**
   * List all files in a folder for a tenant.
   */
  list(folder: string, tenantId: string): Promise<UploadedFile[]>

  /**
   * Get metadata for a stored file without fetching the content.
   */
  getMetadata(storedName: string): Promise<Omit<UploadedFile, 'url'> | null>
}

export const StorageFolders = {
  AVATARS: 'avatars',
  DOCUMENTS: 'documents',
  INVOICES: 'invoices',
  PAYSLIPS: 'payslips',
  CONTRACTS: 'contracts',
  REPORTS: 'reports',
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  LOGOS: 'logos',
} as const
