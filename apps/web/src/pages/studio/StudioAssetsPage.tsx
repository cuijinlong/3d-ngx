
import { Button, Card, Empty, Typography, Upload, message } from "antd";
import { useEffect, useState } from "react";
import { importAssetFile, deleteAsset, listAssets } from "../../services/asset/assetService";
import type { StoredAsset } from "../../services/storage/db";

export function StudioAssetsPage() {
  const [rows, setRows] = useState<StoredAsset[]>([]);
  const refresh = () => void listAssets().then(setRows);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">模型资源</h1>
            <p className="page-sub">GLB/GLTF 优先，高斯溅射与网格模型分开处理。文件保存在本机浏览器。</p>
          </div>
          <Upload
            accept=".glb,.gltf,.png,.jpg,.jpeg,.hdr,.ply"
            showUploadList={false}
            beforeUpload={async (file) => {
              try {
                await importAssetFile(file);
                message.success("已导入");
                refresh();
              } catch (error) {
                message.error(error instanceof Error ? error.message : "导入失败");
              }
              return false;
            }}
          >
            <Button type="primary">导入文件</Button>
          </Upload>
        </div>
        {rows.length === 0 ? <Empty description="还没有资源" /> : (
          <div className="card-grid">
            {rows.map((a) => (
              <Card key={a.id} title={a.name} extra={a.type.toUpperCase()} actions={[
                <Button type="link" danger key="del" onClick={() => void deleteAsset(a.id).then(refresh)}>删除</Button>,
              ]}>
                <Typography.Text type="secondary">
                  {(a.fileSize ? `${(a.fileSize / 1024 / 1024).toFixed(2)} MB` : "—")} · {a.status}
                </Typography.Text>
                {a.type === "gsplat" ? <div style={{ marginTop: 8 }}>高斯溅射资源，使用独立加载器，不会按普通网格处理。</div> : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
