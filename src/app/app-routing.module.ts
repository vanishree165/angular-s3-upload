import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { UploadFormComponent } from './upload-form/upload-form.component';

const routes: Routes = [
  { path: "", redirectTo: "upload-form", pathMatch: "full" },
  { path: "upload-form", component: UploadFormComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
