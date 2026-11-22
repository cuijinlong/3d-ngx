
import { Button, List, Typography, Upload } from "antd";
import { useEffect, useState } from "react";
import type { StoredAsset } from "../../services/storage/db";
import { deleteAsset, listAssets } from "../../services/asset/assetService";

export function AssetPanel({ onImport }: { onImport: (file: File) => void }) {
  const [rows, setRows] = useState<StoredAsset[]>([]);
  const refresh = () => void listAssets().then(setRows);
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={{ padding: 8 }}>
      <Upload accept=".glb,.gltf,.png,.jpg,.jpeg,.hdr" showUploadList={false} beforeUpload={(f) => { onImport(f); setTimeout(refresh, 300); return false; }}>
        <Button size="small">导入文件</Button>
      </Upload>
      <List
        size="small"
        style={{ marginTop: 8 }}
        dataSource={rows}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button type="link" size="small" danger key="del" onClick={() => void deleteAsset(item.id).then(refresh)}>
                删除
              </Button>,
            ]}
          >
            <div>
              <div>{item.name}</div>
              <Typography.Text type="secondary">
                {item.type.toUpperCase()} · {formatSize(item.fileSize)}
              </Typography.Text>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
}

function formatSize(size?: number): string {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
