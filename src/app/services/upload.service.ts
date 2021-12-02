import { Injectable, EventEmitter } from "@angular/core";
import * as AWS from "aws-sdk";
import * as uuid from "uuid";
import * as AmazonCognitoIdentity from "amazon-cognito-identity-js";
import Axios from "axios";
import { environment } from "../environments/environment";

interface Part {
  ETag: string;
  PartNumber: number;
}

@Injectable({
  providedIn: "root",
})
export class UploadService {
  public uploadProgress: EventEmitter<any> = new EventEmitter<any>();

  public videoProgress: EventEmitter<any> = new EventEmitter<any>();

  public returnDataResponse: EventEmitter<any> = new EventEmitter<any>();

  public UserPoolId = "";

  public ClientId = "";

  public IdentityPoolId = "";

  public Username = "";

  public Password = "";

  public defaultRegion = "";

  public s3ImageBucketName = "";

  public s3VideoBucketName = "";

  public startTime = new Date();

  public partNum = 0;

  public partSize = 5 * 1024 * 1024; // Minimum 5MB per chunk (except the last part) http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html

  public numPartsLeft = 0;

  public maxUploadTries = 3;

  public multiPartParams = {};

  public multipartMap = {
    Parts: [],
  };

  public multipartUploadProgress = {};

  public inProgressUpload = {};

  public CancelToken;

  public constructor() {
    this.ClientId = environment.awsConfig.ClientId;
    this.IdentityPoolId = environment.awsConfig.IdentityPoolId;
    this.Username = environment.awsConfig.Username;
    this.UserPoolId = environment.awsConfig.UserPoolId;
    this.Password = environment.awsConfig.Password;
    this.defaultRegion = environment.awsConfig.defaultRegion;
    this.s3ImageBucketName = environment.awsConfig.imageBucketName;
    this.s3VideoBucketName = environment.awsConfig.videoBucketName;
    const poolData = { UserPoolId: this.UserPoolId, ClientId: this.ClientId };
    const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(
      {
        Username: this.Username,
        Password: this.Password,
      }
    );
    const userData = { Username: this.Username, Pool: userPool };

    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    const { IdentityPoolId, defaultRegion, UserPoolId } = this;
    const awsApi = `cognito-idp.${defaultRegion}.amazonaws.com/${UserPoolId}`;
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess(result): void {
        AWS.config.update({
          region: defaultRegion,
          credentials: new AWS.CognitoIdentityCredentials({
            IdentityPoolId,
            Logins: {
              [awsApi]: result.getIdToken().getJwtToken(),
            },
          }),
        });
      },
      onFailure(err): void {
        console.error("onFailure", err);
      },
      // newPasswordRequired(userAttributes): void {
      //   const userAttr = userAttributes;
      //   delete userAttr.email_verified;
      //   // unsure about this field, but I don't send this back
      //   delete userAttr.phone_number_verified;
      //   // Get these details and call
      //   cognitoUser.completeNewPasswordChallenge(
      //     'aTbd@12XWAqCWOH1fOH',
      //     userAttr,
      //     this,
      //   );
      // },
    });
    const { CancelToken } = Axios;
    this.CancelToken = CancelToken.source();
  }

  public bucketName(type: string): any {
    console.info(type);
    if (type.match(/image/)) return this.s3ImageBucketName;
    return this.s3VideoBucketName;
  }

  async initiateMultipartUpload(file: File, filename: string): Promise<string> {
    const s3 = new AWS.S3({
      sessionToken: `session-${uuid.v4()}`,
    });

    const params = {
      Bucket: this.bucketName(file.type),
      Key: filename,
    };

    const res = await s3.createMultipartUpload(params).promise();

    return res.UploadId;
  }

  async generatePresignedUrlsParts(
    s3: AWS.S3,
    file: File,
    filename: string,
    uploadId: string,
    fromScreen: string
  ): Promise<any> {
    try {
      const baseParams = {
        Bucket: this.bucketName(file.type),
        Key: filename,
        Expires: 60,
        UploadId: uploadId,
      };
      const promises = [];
      Array.from({ length: 3 }, (v, i) => i + 1).map((partNo) =>
        promises.push(
          s3.getSignedUrlPromise("uploadPart", {
            ...baseParams,
            PartNumber: partNo,
          })
        )
      );
      return Promise.all(promises);
    } catch (error) {
      this.returnDataResponse.emit({ fromScreen, type: "error", error });
      return null;
    }
  }

  calculatePercentage(index: number, totalSize: number): number {
    const currentIndexUpload = Object.values(
      this.multipartUploadProgress[index]
    ).reduce((sum: number, val: number): number => sum + val, 0) as number;
    return Math.round((currentIndexUpload / totalSize) * 100);
  }

  async uploadParts(
    s3Client: AWS.S3,
    file: File,
    filename: string,
    uploadId: string,
    fromScreen: string,
    index: number
  ): Promise<any> {
    try {
      const axios = Axios.create();
      delete axios.defaults.headers.put["Content-Type"];

      return this.generatePresignedUrlsParts(
        s3Client,
        file,
        filename,
        uploadId,
        fromScreen
      ).then(async (urls) => {
        const promises = [];
        console.info(urls);

        const multipartStatus = {};
        urls.forEach((url: string, i: number) => {
          const indexVal = i;
          const start = indexVal * this.partSize;
          const end = (indexVal + 1) * this.partSize;
          const blob =
            indexVal < urls.length ? file.slice(start, end) : file.slice(start);
          // console.info(blob.size);
          multipartStatus[i] = {};
          const { CancelToken } = Axios;
          const config = {
            cancelToken: new CancelToken(function executor(c) {
              // An executor function receives a cancel function as a parameter
              multipartStatus[i].cancel = c;
            }),
            onUploadProgress: (progressEvent: ProgressEvent) => {
              this.multipartUploadProgress[index] = {
                ...this.multipartUploadProgress[index],
                [i]: progressEvent.loaded,
              };
              const uploaded = this.calculatePercentage(index, file.size);
              this.inProgressUpload[filename] = {};
              this.inProgressUpload[filename].fileName = filename;
              this.inProgressUpload[filename].type = file.type;
              this.inProgressUpload[filename].uploadId = uploadId;
              this.inProgressUpload[filename].percentCompleted = uploaded;
              this.inProgressUpload[filename].multipartStatus = multipartStatus;
              this.uploadProgress.emit({
                fromScreen,
                uploaded,
                index,
                completed: false,
                fileName: filename,
              });
            },
          };
          promises.push(axios.put(url, blob, config));
        });
        try {
          const resParts = await Promise.all(promises);
          return resParts.map((part, i) => {
            return {
              ETag: part.headers.etag,
              PartNumber: i + 1,
            };
          });
        } catch (err) {
          return err;
        }
      });
    } catch (error) {
      this.returnDataResponse.emit({ fromScreen, type: "error", error });
      return null;
    }
  }

  async completeMultiUpload(
    s3Client: AWS.S3,
    file: File,
    filename: string,
    fromScreen: string,
    index: number
  ): Promise<any> {
    try {
      const uploadId = await this.initiateMultipartUpload(file, filename);
      return this.uploadParts(
        s3Client,
        file,
        filename,
        uploadId,
        fromScreen,
        index
      ).then(async (parts) => {
        try {
          const params = {
            Bucket: this.bucketName(file.type),
            Key: filename,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          };
          const response = await s3Client
            .completeMultipartUpload(params)
            .promise();
          this.uploadProgress.emit({
            fromScreen,
            uploaded: 100,
            index,
            fileName: filename,
            completed: true,
          });
          const responseData = { ...response, Key: filename };
          this.returnDataResponse.emit({
            fromScreen,
            type: "success",
            data: responseData,
          });

          return response;
        } catch (err) {
          return null;
        }
      });
    } catch (error) {
      this.returnDataResponse.emit({ fromScreen, type: "error", error });
      return null;
    }
  }

  public uploadAttachment(
    file: File,
    index: number,
    fromScreen: string
  ): string {
    const uniquename = uuid.v4();
    const fileExtension = file.name.replace(/^.*\./, "");
    const filename = `${localStorage.getItem(
      "loginUserId"
    )}/${uniquename}.${fileExtension}`;
    this.numPartsLeft = 0;
    this.multipartUploadProgress = {};
    const S3Client = new AWS.S3({
      params: { Bucket: this.bucketName(file.type), maxRetries: 10 },
      httpOptions: { timeout: 360000 },
    });
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = (ev): void => {
      const buffer = ev.target.result as ArrayBuffer;

      if (buffer.byteLength >= this.partSize) {
        this.completeMultiUpload(S3Client, file, filename, fromScreen, index);
      } else {
        this.uploadFiles(file, filename, index, fromScreen);
      }
    };
    return filename;
  }

  public uploadImageFile(file: File): any {
    console.info(file);
    const uniquename = uuid.v4();
    const fileExtension = file.name.replace(/^.*\./, "");
    const filename = `${localStorage.getItem(
      "loginUserId"
    )}/${uniquename}.${fileExtension}`;

    const params = {
      Bucket: this.s3ImageBucketName,
      Key: filename,
      Body: file,
      ExpiresIn: 60,
      ACL: "public-read",
      ContentType: file.type,
    };

    const S3Client = new AWS.S3();

    return new Promise((res, rej): any => {
      S3Client.upload(params, (err: any, data: any): any => {
        if (err) {
          rej(err);
        }
        res(data);
      }).on("httpUploadProgress", (event): any => {
        const uploaded = Math.round((event.loaded / event.total) * 100);
        const completed = uploaded === 100;
        console.info("progress", uploaded);
        this.uploadProgress.emit({
          fromScreen: "",
          uploaded,
          completed,
          index: 0,
        });
      });
    });
  }

  public abortUpload(filename: string): void {
    console.info(
      "abortUpload",
      filename,
      this.inProgressUpload,
      this.inProgressUpload[filename]
    );
    if (this.inProgressUpload[filename].uploadId) {
      this.abortMultipartUpload(filename);
    } else {
      this.inProgressUpload[filename].upload.abort();
      this.deleteUpload(filename);
    }
  }

  public abortMultipartUpload(filename: string): void {
    try {
      const { multipartStatus } = this.inProgressUpload[filename];
      Object.values(multipartStatus).forEach((mp: Record<string, any>) => {
        mp.cancel();
      });

      this.deleteUpload(filename);
    } catch (error) {
      if (Axios.isCancel(error)) {
        console.info(error);
      }
    }
  }

  public deleteUpload(filename: string): void {
    const file = this.inProgressUpload[filename];
    this.deleteS3Object(filename, file.type);
  }

  public deleteS3Object(fileName: string, fileType: string): void {
    const params = {
      Bucket: this.bucketName(fileType),
      Key: fileName,
    };
    const S3Client = new AWS.S3();
    S3Client.deleteObject(params, (err, data): any => {
      if (err) console.info(err, err.stack);
      // an error occurred
      else console.info(data); // successful response
    });
  }

  public getVideoCover(file: File, seekTo = 0.0): any {
    // console.log('getting video cover for file: ', file);
    return new Promise((resolve, reject): any => {
      // load the file to a video player
      const videoPlayer = document.createElement("video");
      videoPlayer.setAttribute("src", URL.createObjectURL(file));
      videoPlayer.load();
      videoPlayer.addEventListener("error", (ex): any => {
        reject(ex);
      });
      // load metadata of the video to get video duration and dimensions
      videoPlayer.addEventListener("loadedmetadata", (): any => {
        // seek to user defined timestamp (in seconds) if possible
        if (videoPlayer.duration < seekTo) {
          reject(new Error("video is too short."));
          return;
        }
        // delay seeking or else 'seeked' event won't fire on Safari
        setTimeout((): void => {
          videoPlayer.currentTime = seekTo;
        }, 200);
        // extract video thumbnail once seeking is complete
        videoPlayer.addEventListener("seeked", (): void => {
          // console.log('video is now paused at %ss.', seekTo);
          // define a canvas to have the same dimension as the video
          const canvas = document.createElement("canvas");
          canvas.width = videoPlayer.videoWidth;
          canvas.height = videoPlayer.videoHeight;
          // draw the video frame to canvas
          const ctx = canvas.getContext("2d");
          ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
          // return the canvas image as a blob
          ctx.canvas.toBlob(
            (blob): void => {
              resolve(blob);
            },
            "image/jpeg",
            0.75 /* quality */
          );
        });
      });
    });
  }

  private uploadFiles(
    file: File,
    filename: string,
    index: number,
    fromScreen: string
  ): void {
    const params = {
      Bucket: this.bucketName(file.type),
      Key: filename,
      Body: file,
      ExpiresIn: 60,
      ACL: "public-read",
      ContentType: file.type,
    };

    const S3Client = new AWS.S3();
    this.inProgressUpload[filename] = {};
    this.inProgressUpload[filename].type = file.type;
    this.inProgressUpload[filename].upload = S3Client.upload(
      params,
      (err: any, data: any): any => {
        if (err) {
          this.returnDataResponse.emit({ fromScreen, type: "error", err });
        }
        this.returnDataResponse.emit({ fromScreen, type: "success", data });
      }
    ).on("httpUploadProgress", (event): any => {
      const uploaded = Math.round((event.loaded / event.total) * 100);
      const completed = uploaded === 100;
      console.info("progress normal upload", uploaded, filename);
      this.uploadProgress.emit({
        fromScreen,
        uploaded,
        completed,
        index,
        fileName: filename,
      });
    });
  }
}
