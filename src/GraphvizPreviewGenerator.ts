import { ExtensionContext, TextDocument, window, ViewColumn, Uri, WebviewPanel, workspace, Disposable } from "vscode";
const { Module, render } = require('viz.js/full.render.js');
let Viz = require("viz.js");
import * as path from "path";
var fs = require("fs");

export class GraphvizPreviewGenerator extends Disposable {

    webviewPanels = new Map<Uri, PreviewPanel>();

    timeout: NodeJS.Timer;

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());
     }

    setNeedsRebuild(uri: Uri, needsRebuild: boolean): void {
        let panel = this.webviewPanels.get(uri);

        if (panel) {
            panel.setNeedsRebuild(needsRebuild);
            
            this.resetTimeout();
        }
    }

    resetTimeout(): void {
        if(this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => this.rebuild(), 1000);
    }

    dispose(): void {
        clearTimeout(this.timeout);
    }

    rebuild(): void {
        this.webviewPanels.forEach(panel => {
            if(panel.getNeedsRebuild() && panel.getPanel().visible)
                this.updateContent(panel, workspace.textDocuments.find(doc => doc.uri == panel.uri));
        });
    }

    async revealOrCreatePreview(doc: TextDocument, displayColumn: ViewColumn): Promise<void> {
        let previewPanel = this.webviewPanels.get(doc.uri);

        if (previewPanel) {
            previewPanel.reveal(displayColumn);
        }
        else {
            previewPanel = this.createPreviewPanel(doc, displayColumn);
            this.webviewPanels.set(doc.uri, previewPanel);
            // when the user closes the tab, remove the panel
            previewPanel.getPanel().onDidDispose(() => this.webviewPanels.delete(doc.uri), undefined, this.context.subscriptions);
            // when the pane becomes visible again, refresh it
            previewPanel.getPanel().onDidChangeViewState(_ => this.rebuild());

            previewPanel.getPanel().webview.onDidReceiveMessage(e => this.handleMessage(previewPanel, e), undefined, this.context.subscriptions);
        }

        this.updateContent(previewPanel, doc);
    }

    handleMessage(previewPanel: PreviewPanel, message: any): void {
        console.log(`Message received from the webview: ${message.command}`);

        switch(message.command){
            case 'scale':
                previewPanel.setScale(message.value);
                break;
            case 'fitToHeight':
                previewPanel.setFitToHeight(message.value);
                break;
            case 'fitToWidth':
                previewPanel.setFitToWidth(message.value);
                break;
            default:
                console.warn('Unexpected command: ' + message.command);
        }
    }

    createPreviewPanel(doc: TextDocument, displayColumn: ViewColumn): PreviewPanel {
        let previewTitle = `Preview: '${path.basename(window.activeTextEditor.document.fileName)}'`;
    
        let previewPanel = window.createWebviewPanel('graphvizPreview', previewTitle, displayColumn, { 
            enableFindWidget: true,
            enableScripts: true,
            localResourceRoots: [Uri.file(path.join(this.context.extensionPath, "content"))]
        });

        return new PreviewPanel(doc.uri, previewPanel);
    }

    async updateContent(previewPanel: PreviewPanel, doc: TextDocument) {
        if(!previewPanel.getPanel().webview.html) {
            previewPanel.getPanel().webview.html = "Please wait...";
        }
        previewPanel.setNeedsRebuild(false);
        previewPanel.getPanel().webview.html = await this.getPreviewHtml(previewPanel, doc);
    }
    
    toSvg(doc: TextDocument): Thenable<string> | string {
        let text = doc.getText();
        return new Viz({Module, render}).renderString(text);
    }

    private async getPreviewTemplate(): Promise<string> {
        let previewPath = this.context.asAbsolutePath(path.join(this.CONTENT_FOLDER, "previewTemplate.html"));

        return new Promise<string>((resolve, reject) => {
            fs.readFile(previewPath, "utf8", function (err, data) {
                if (err) reject(err);
                else resolve(data);
            });
        });
    }

    CONTENT_FOLDER = "content";

    private async getPreviewHtml(previewPanel: PreviewPanel, doc: TextDocument): Promise<string> {
        let templateHtml = await this.getPreviewTemplate();
        
        // change resource URLs to vscode-resource:
        templateHtml = templateHtml.replace(/<script src="(.+)">/g, (scriptTag, srcPath) => {
            scriptTag;
            let resource=Uri.file(
                path.join(this.context.extensionPath, 
                    this.CONTENT_FOLDER, 
                    srcPath))
                    .with({scheme: "vscode-resource"});
            return `<script src="${resource}">`;
        }).replace("initializeScale(1,false,false)", 
            `initializeScale(${previewPanel.getScale()}, ${previewPanel.getFitToWidth()}, ${previewPanel.getFitToHeight()})`);

        let svg = "";
        try {
            svg = await this.toSvg(doc);
        }catch(error){
            svg = error.toString();
        }

        return templateHtml.replace("PLACEHOLDER", svg);
    }
} 

class PreviewPanel {

    needsRebuild: boolean;
    scale = 1;
    fitToWidth = false;
    fitToHeight = false;

    constructor(public uri: Uri, private panel: WebviewPanel) {}

    setScale(value: number): void {
        this.scale = value;
    }

    getScale(): number {
        return this.scale;
    }

    setFitToWidth(value: boolean): void {
        this.fitToWidth = value;
    }

    getFitToWidth(): boolean {
        return this.fitToWidth;
    }

    setFitToHeight(value: boolean): void {
        this.fitToHeight = value;
    }

    getFitToHeight(): boolean {
        return this.fitToHeight;
    }

    reveal(displayColumn: ViewColumn): void {
        this.panel.reveal(displayColumn);
    }

    setNeedsRebuild(needsRebuild: boolean) {
        this.needsRebuild = needsRebuild;
    }

    getNeedsRebuild(): boolean {
        return this.needsRebuild;
    }

    getPanel(): WebviewPanel {
        return this.panel;
    }
}