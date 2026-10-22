// Lista padrão de canais e formatos (decisão de 22/10/2026). "Outro" abre campo livre.
export const CANAIS: Record<string, string[]> = {
  "Meta Ads": ["Feed", "Stories", "Reels", "Carrossel"],
  "Google Ads": ["Display", "YouTube", "Pesquisa"],
  "LinkedIn Ads": ["Feed", "Carrossel", "Vídeo"],
  "TikTok Ads": ["In-feed", "Spark Ads"],
};
export const OUTRO = "Outro";

export const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"];
export const EXTENSOES_ACEITAS = ".jpg,.jpeg,.png,.webp,.mp4,.pdf";
export const LIMITE_BYTES = 50 * 1024 * 1024;

export function formatarTamanho(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
