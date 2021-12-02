import { Component, OnInit } from '@angular/core';
import { UploadService } from "../services/upload.service";
import { ToastrService } from "ngx-toastr";

@Component({
  selector: 'app-upload-form',
  templateUrl: './upload-form.component.html',
  styleUrls: ['./upload-form.component.scss'],
})
export class UploadFormComponent implements OnInit {
  public addedFiles = [];

  public totalSelectedFile;

  public Upfile = false;

  public progress = [];

  public uploadProcess = false;

  public processFileStatus = true;

  public constructor(private awsUplaod: UploadService, private toastr: ToastrService) {}

  public ngOnInit(): void {
    this.awsUplaod.uploadProgress.subscribe((progressObj: any): void => {
      if (progressObj.fromScreen === "uploadFile") {
        this.progress[progressObj.index] = progressObj;
        if (this.addedFiles[progressObj.index]) {
          if (
            this.addedFiles[progressObj.index].progressPercent <
            progressObj.uploaded
          ) {
            this.addedFiles[progressObj.index].progressPercent =
              progressObj.uploaded;
          }
          this.addedFiles[progressObj.index].completed = progressObj.completed;
          this.addedFiles[progressObj.index].showProgressBar =
            progressObj.uploaded !== 100;
          this.addedFiles[progressObj.index].fileName = progressObj.fileName;
        }
      }
      this.processFileStatus = this.addedFiles.every(
        (file): any => file.completed
      );
    });
    this.awsUplaod.returnDataResponse.subscribe((response: any): void => {
      if (response.fromScreen === "uploadFile") {
        if (
          response.type === "success" &&
          response.data &&
          response.data.Key !== null
        ) {
          console.log("Files key", response.data.Key);
        }
      }
    });
  }

  public fileSelectEvent(event: any): void {
    const { files } = event.target;
    if (files) {
      this.totalSelectedFile = Array.from(files).length;
      const uploadLength = this.addedFiles.length;
      this.Upfile = true;
      Array.from(files).forEach((file: any, i): void => {
        const indx = i + uploadLength;
        const reader = new FileReader();
        if (file.type.indexOf('image') > -1) {
          reader.readAsDataURL(file);
        } else if (file.type.indexOf('video') > -1) {
          this.awsUplaod.getVideoCover(file, 0.5).then((res: any): any => {
            reader.readAsDataURL(res);
          });
        } else {
          this.toastr.error('Invalid File format', '', {
            closeButton: true,
          });
        }
        const img = new Image();
        img.src = window.URL.createObjectURL(file);
        reader.onload = (ev): void => {
          this.addedFiles[indx] = {
            fileData: ev.target.result,
            showProgressBar: true,
            progressPercent: 0,
            completed: false,
          };
          this.updateEvent(file, indx);
        };
      });
    }
  }

  public updateEvent(file: File, index: number): void {
    if (this.addedFiles.length === 0) {
      this.uploadProcess = true;
    }
    this.addedFiles[index].fileName = this.awsUplaod.uploadAttachment(
      file,
      index,
      'uploadFile'
    );
    this.uploadProcess = false;
  }

  public removeFile(indx: number): void {
    this.totalSelectedFile -= 1;
    this.awsUplaod.abortUpload(this.addedFiles[indx].fileName);
    this.addedFiles.splice(indx, 1);
    this.Upfile = this.addedFiles.length > 0;
    this.processFileStatus = this.addedFiles.every(
      (file): any => file.completed
    );
  }
}
